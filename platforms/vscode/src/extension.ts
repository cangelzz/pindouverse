import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { dispatchNewProjectCommand } from "./newProjectCommand";
import { handleUiPlatformMessage } from "./uiPlatformHost";
import { saveDocument } from "./saveDocument";
import { SaveQueue } from "./saveQueue";
import { BlueprintEditorRegistry, BlueprintToolRouter, registerBlueprintTools, type BlueprintPanel } from "./blueprintTools";
import { SaveHandoffCoordinator, SessionChannel, type SavedBlueprint } from "./saveHandoff";
import { BlueprintFileAccess } from "./blueprintFileAccess";
import { toolFailure, stampSchema, type ToolResult, TOOL_LIMITS } from "../../../src/blueprint/toolContract";
import { serializeProjectToV3 } from "../../../src/utils/projectSerialization";
import type { EditorSessionSnapshot } from "../../../src/types";
import { randomUUID } from "node:crypto";
import { imageSize } from "image-size";

interface LiveEditor {
  editorId: string;
  panel: vscode.WebviewPanel;
  transport: BlueprintPanel;
  document: vscode.TextDocument;
  isUntitled: boolean;
  save(content: string): Promise<void>;
  abortSave?: () => void;
}

// The custom editor panel that currently has focus. Used by the
// pindouverse.undo/redo commands (bound to Ctrl+Z/Y) to forward undo/redo into
// the active webview, which owns the single undo stack. See the keybindings in
// package.json (scoped via when: activeCustomEditorId).
let activePindouWebview: vscode.WebviewPanel | undefined;

async function createUntitledProject(
  context: vscode.ExtensionContext,
  width: number = 52,
  height: number = 52
): Promise<void> {
  const w = Math.max(1, Math.min(256, Math.floor(width) || 52));
  const h = Math.max(1, Math.min(256, Math.floor(height) || 52));

  const tmpDir = context.globalStorageUri;
  await vscode.workspace.fs.createDirectory(tmpDir);
  const tmpUri = vscode.Uri.joinPath(tmpDir, `untitled_${Date.now()}.pindou`);

  const emptyProject = {
    version: 1,
    canvasSize: { width: w, height: h },
    canvasData: Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ colorIndex: null }))
    ),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await vscode.workspace.fs.writeFile(
    tmpUri,
    Buffer.from(JSON.stringify(emptyProject, null, 2))
  );
  await vscode.commands.executeCommand("vscode.openWith", tmpUri, "pindouverse.editor");
}

export function activate(context: vscode.ExtensionContext) {
  const registry = new BlueprintEditorRegistry();
  const router = new BlueprintToolRouter(registry, () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom && input.viewType === "pindouverse.editor"
      ? registry.idForUri(input.uri.toString()) : undefined;
  }, () => vscode.workspace.isTrusted);
  context.subscriptions.push(router, ...registerBlueprintTools(vscode, router, context.extensionMode === vscode.ExtensionMode.Test));
  context.subscriptions.push(
    PindouEditorProvider.register(context, createUntitledProject, router)
  );

  // Command Palette must use the same in-webview dirty guard as the toolbar.
  // With no active PindouVerse editor there is no project to protect, so opening
  // a default untitled project remains the useful fallback.
  context.subscriptions.push(
    vscode.commands.registerCommand("pindouverse.newProject", async () => {
      await dispatchNewProjectCommand({
        language: vscode.env.language,
        getActivePanel: () => activePindouWebview,
        clearActivePanel: (panel) => {
          if (activePindouWebview === panel) activePindouWebview = undefined;
        },
        createUntitled: () => createUntitledProject(context),
        showSendError: (message) => { void vscode.window.showErrorMessage(message); },
      });
    })
  );

  // Command: open existing .pindou file
  context.subscriptions.push(
    vscode.commands.registerCommand("pindouverse.openProject", async () => {
      const uris = await vscode.window.showOpenDialog({
        filters: { "PindouVerse Project": ["pindou"] },
        canSelectMany: false,
      });
      if (!uris || uris.length === 0) return;
      await vscode.commands.executeCommand("vscode.openWith", uris[0], "pindouverse.editor");
    })
  );

  // Commands: undo / redo. Bound to Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z in
  // package.json, scoped to our custom editor. They forward to the focused
  // webview instead of letting VS Code undo the underlying TextDocument (which
  // would revert the whole .pindou file to its last-saved state and wipe every
  // unsaved edit).
  context.subscriptions.push(
    vscode.commands.registerCommand("pindouverse.undo", () => {
      activePindouWebview?.webview.postMessage({ type: "undo" });
    }),
    vscode.commands.registerCommand("pindouverse.redo", () => {
      activePindouWebview?.webview.postMessage({ type: "redo" });
    })
  );
  return context.extensionMode === vscode.ExtensionMode.Test ? router.testControls : undefined;
}

export function deactivate() {}

class PindouEditorProvider implements vscode.CustomTextEditorProvider {
  private testSaveDestination: string | undefined;
  private failDestinationOnce = false;
  private readonly liveEditors = new Map<string, LiveEditor>();
  private readonly sessions = new SessionChannel();
  private readonly stagedOwners = new Map<string, string>();
  private readonly readyWaiters = new Map<string, Set<(editor: LiveEditor) => void>>();
  private readonly fileAccess = new BlueprintFileAccess(vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [], () => vscode.workspace.isTrusted);
  private static readonly viewType = "pindouverse.editor";
  private readonly panels = new Set<vscode.WebviewPanel>();
  private languageUpdateQueue: Promise<void> = Promise.resolve();

  static register(
    context: vscode.ExtensionContext,
    createUntitled: (ctx: vscode.ExtensionContext, w?: number, h?: number) => Promise<void>,
    router: BlueprintToolRouter,
  ): vscode.Disposable {
    const provider = new PindouEditorProvider(context, createUntitled, router);
    if (context.extensionMode === vscode.ExtensionMode.Test) router.testControls = {
      waitForEditor: async uri => { await provider.waitForReady(uri); },
      setSaveDestination: file => { provider.testSaveDestination = file; },
      failNextDestination: () => { provider.failDestinationOnce = true; },
    };
    router.saveHandler = (editorId, expectedRevision, signal) => provider.saveBlueprint(editorId, "save", expectedRevision, signal);
    router.releaseFile = operationId => provider.fileAccess.revokeOperation(operationId);
    router.prepareFile = async (editorId, operation, value, operationId, signal) => {
      const input = value as { path?: string; format?: string };
      const mode = operation === "import_image" ? "read" : "write";
      let file = input.path;
      let userSelected = false;
      if (mode === "write" || !file) {
        const uri = mode === "write"
          ? await vscode.window.showSaveDialog({ defaultUri: file ? vscode.Uri.file(file) : undefined, filters: input.format === "jpeg" ? { JPEG: ["jpg", "jpeg"] } : { PNG: ["png"] } })
          : (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: ["png", "jpg", "jpeg", "gif", "bmp", "webp"] } }))?.[0];
        if (!uri || signal.aborted) return toolFailure("cancelled", "File selection cancelled");
        file = uri.fsPath;
        userSelected = true;
      }
      if (vscode.workspace.textDocuments.some(document => document.uri.fsPath === file && document.isDirty)) return toolFailure("permission_denied", "The destination has unsaved edits");
      const grant = await provider.fileAccess.authorize(file, mode, editorId, operationId, userSelected);
      return { grantId: grant.id, path: grant.path };
    };
    return vscode.window.registerCustomEditorProvider(
      PindouEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly createUntitled: (ctx: vscode.ExtensionContext, w?: number, h?: number) => Promise<void>,
    private readonly router: BlueprintToolRouter,
  ) {}

  private waitForReady(uri: string): Promise<LiveEditor> {
    const id = this.router.registry.idForUri(uri);
    if (id && this.router.registry.resolveEditor(id)?.stamp && this.liveEditors.has(id)) return Promise.resolve(this.liveEditors.get(id)!);
    return new Promise((resolve, reject) => {
      const listeners = this.readyWaiters.get(uri) ?? new Set();
      const ready = (editor: LiveEditor) => { clearTimeout(timer); listeners.delete(ready); if (!listeners.size) this.readyWaiters.delete(uri); resolve(editor); };
      const timer = setTimeout(() => { listeners.delete(ready); if (!listeners.size) this.readyWaiters.delete(uri); reject(new Error("Destination editor did not become ready")); }, TOOL_LIMITS.handoffTimeoutMs);
      listeners.add(ready);
      this.readyWaiters.set(uri, listeners);
    });
  }

  private async saveBlueprint(editorId: string, mode: "save" | "saveAs", expectedRevision?: number, signal = new AbortController().signal, forcedPath?: string, beforeRetire?: (result: ToolResult) => Promise<void>): Promise<ToolResult> {
    const source = this.liveEditors.get(editorId);
    const record = this.router.registry.resolveEditor(editorId);
    if (!source || !record?.stamp) return toolFailure("editor_closed", "The source editor is not ready");
    if (record.saving) return toolFailure("editor_busy", "A save is already in progress");
    if (!vscode.workspace.isTrusted) return toolFailure("permission_denied", "Live file operations require workspace trust");
    record.saving = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    source.abortSave = abort;
    const ownerId = `save:${randomUUID()}`;
    const generation = record.stamp.projectGeneration;
    const control = (type: string, data: Record<string, unknown> = {}) => this.sessions.request(source.transport, type, ownerId, { expectedGeneration: generation, ...data });
    const capture = async () => {
      if (controller.signal.aborted) throw new Error("Save was cancelled or the source changed");
      return await control("blueprintCaptureForSave", expectedRevision === undefined ? {} : { expectedRevision }) as SavedBlueprint;
    };
    let destination: LiveEditor | undefined;
    let destinationUri: string | undefined;
    try {
      if (mode === "save" && !source.isUntitled && !forcedPath) {
        const saved = await capture();
        await source.save(serializeProjectToV3(saved.project));
        const stamp = stampSchema.parse(await control("blueprintFinalizeSave", { saved, inPlace: true }));
        return { ok: true, stamp, summary: "Saved blueprint", value: { path: source.document.uri.fsPath, savedRevision: saved.savedRevision, fileWritten: true } };
      }
      const access = new BlueprintFileAccess(vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [], () => vscode.workspace.isTrusted);
      const coordinator = new SaveHandoffCoordinator({
        selectDestination: async () => {
          const selectedPath = this.testSaveDestination ?? forcedPath;
          const uri = selectedPath ? vscode.Uri.file(selectedPath) : await vscode.window.showSaveDialog({ filters: { "PindouVerse Project": ["pindou"] }, defaultUri: source.isUntitled ? undefined : source.document.uri });
          if (!uri) return null;
          if (uri.toString() === source.document.uri.toString()) throw new Error("Use Save for the current document path");
          if (this.router.registry.idForUri(uri.toString())) throw new Error("The destination is already open in a Pindou editor");
          destinationUri = uri.toString();
          return uri.fsPath;
        },
        capture,
        write: async (file, saved) => {
          const grant = await access.authorize(file, "write", editorId, ownerId, true);
          await access.validate(grant.id, "write", editorId, ownerId);
          if (controller.signal.aborted) throw new Error("Save cancelled before write");
          await vscode.workspace.fs.writeFile(vscode.Uri.file(file), Buffer.from(serializeProjectToV3(saved.project)));
        },
        lock: async () => await control("blueprintAcquireSession") as EditorSessionSnapshot,
        restore: async (file, snapshot, saved) => {
          if (this.failDestinationOnce) { this.failDestinationOnce = false; throw new Error("Test destination startup failure"); }
          const uri = vscode.Uri.file(file);
          this.stagedOwners.set(uri.toString(), ownerId);
          const ready = this.waitForReady(uri.toString());
          await Promise.all([vscode.commands.executeCommand("vscode.openWith", uri, "pindouverse.editor"), ready]);
          destination = await ready;
          destination.abortSave = abort;
          return stampSchema.parse(await this.sessions.request(destination.transport, "blueprintRestoreSession", ownerId, { path: file, snapshot, saved }));
        },
        finalize: async saved => { await control("blueprintFinalizeSave", { saved, inPlace: false }); },
        enable: async () => {
          if (!destination || !await destination.transport.postMessage({ type: "blueprintEnableSession", handoffId: `handoff:${randomUUID()}`, ownerId })) throw new Error("Cannot enable the restored destination");
        },
        beforeRetire: beforeRetire ? async result => {
          await beforeRetire(result);
          await control("blueprintFinalizeSave", { inPlace: false });
        } : undefined,
        disposeSource: () => source.panel.dispose(),
        abortDestination: async () => {
          const stagedId = destinationUri ? this.router.registry.idForUri(destinationUri) : undefined;
          const staged = destination ?? (stagedId ? this.liveEditors.get(stagedId) : undefined);
          staged?.panel.dispose();
        },
        releaseSource: async () => { if (this.liveEditors.has(editorId)) await control("blueprintReleaseSession"); },
      });
      const result = await coordinator.run(controller.signal);
      access.revokeOperation(ownerId);
      return result.ok ? result : { ...result, error: { ...result.error, details: { ...result.error.details as object, sourceEditorId: editorId } } };
    } catch (error) {
      return toolFailure("outcome_unknown", error instanceof Error ? error.message : "Save could not be confirmed; inspect before retrying");
    } finally {
      record.saving = false;
      source.abortSave = undefined;
      if (destination) destination.abortSave = undefined;
      signal.removeEventListener("abort", abort);
      if (destinationUri) this.stagedOwners.delete(destinationUri);
    }
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const toolPanel = { postMessage: (message: unknown) => webviewPanel.webview.postMessage(message) };
    const editorId = this.router.registry.registerPanel(toolPanel, document.uri.toString());
    this.panels.add(webviewPanel);
    const panelSub = webviewPanel.onDidDispose(() => this.panels.delete(webviewPanel));
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
      ],
    };

    // Set webview HTML
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Detect "New Project" temp files: they live under globalStorageUri and are
    // named untitled_<timestamp>.pindou. For these, the webview should treat
    // the project as having no real path so Save will prompt for a destination
    // (instead of silently overwriting the temp file).
    const tmpDirPath = this.context.globalStorageUri.fsPath;
    const isUntitled =
      document.uri.fsPath.startsWith(tmpDirPath) &&
      /[\\/]untitled_\d+\.pindou$/i.test(document.uri.fsPath);

    // A document living inside a .pindou_autosave folder is a backup the user
    // opened to inspect/recover. The webview turns off autosave for these so the
    // 60s timer can't overwrite (or, pre-fix, nest more copies under) the backup.
    const isBackup = /[\\/]\.pindou_autosave[\\/]/.test(document.uri.fsPath);

    // Track this panel as the active one while it has focus, so the
    // pindouverse.undo/redo commands forward keystrokes to the right webview.
    if (webviewPanel.active) activePindouWebview = webviewPanel;
    const viewStateSub = webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        activePindouWebview = webviewPanel;
      } else if (activePindouWebview === webviewPanel) {
        activePindouWebview = undefined;
      }
    });

    // Send initial document content to webview
    const sendDocument = () => {
      webviewPanel.webview.postMessage({
        type: "loadDocument",
        editorId,
        liveSave: true,
        sessionOwnerId: this.stagedOwners.get(document.uri.toString()),
        content: document.getText(),
        path: document.uri.fsPath,
        isUntitled,
        isBackup,
      });
    };

    // Suppress reload during save (our own edit triggers onDidChangeTextDocument)
    let isSaving = false;
    const saveQueue = new SaveQueue((value) => { isSaving = value; });
    const liveEditor: LiveEditor = { editorId, panel: webviewPanel, transport: toolPanel, document, isUntitled,
      save: async content => {
        await saveQueue.run(async () => {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), content);
          if (!await vscode.workspace.applyEdit(edit) || !await document.save()) throw new Error("VS Code could not save the document");
        });
      },
    };
    this.liveEditors.set(editorId, liveEditor);

    // Listen for document changes (external edits)
    const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && !isSaving) {
        liveEditor.abortSave?.();
        sendDocument();
      }
    });

    // Listen for messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if ((msg?.type === "readFile" || msg?.type === "writeFile") && msg.agentFileGrantId) {
        try {
          const mode = msg.type === "readFile" ? "read" : "write";
          const grant = await this.fileAccess.validate(msg.agentFileGrantId, mode, editorId, msg.agentOperationId);
          if (msg.path !== grant.path) throw new Error("File request differs from its grant");
          if (mode === "read") {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(grant.path));
            if (!bytes.length || bytes.length > TOOL_LIMITS.imageBytes) throw new Error("Image exceeds byte limit");
            const dimensions = imageSize(bytes);
            if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > TOOL_LIMITS.decodedPixels) throw new Error("Image exceeds decoded pixel limit");
            const extension = path.extname(grant.path).slice(1).toLowerCase().replace("jpeg", "jpg");
            if (dimensions.type !== extension || !["png", "jpg", "gif", "bmp", "webp"].includes(extension)) throw new Error("Image content does not match its extension");
            await webviewPanel.webview.postMessage({ type: "fileResult", requestId: msg.requestId, success: true,
              data: Buffer.from(bytes).toString("base64"), mimeType: `image/${extension === "jpg" ? "jpeg" : extension}` });
          } else {
            if (typeof msg.data !== "string" || msg.data.length > Math.ceil(TOOL_LIMITS.outputBytes * 4 / 3) + 4) throw new Error("Output exceeds byte budget");
            const bytes = Buffer.from(msg.data, "base64");
            const dimensions = imageSize(bytes);
            if (bytes.length > TOOL_LIMITS.outputBytes || dimensions.width * dimensions.height > TOOL_LIMITS.exportPixels) throw new Error("Output exceeds image budget");
            const extension = path.extname(grant.path).slice(1).toLowerCase().replace("jpeg", "jpg");
            if (!["png", "jpg"].includes(extension) || dimensions.type !== extension) throw new Error("Output type does not match its path");
            await this.fileAccess.validate(msg.agentFileGrantId, mode, editorId, msg.agentOperationId);
            await vscode.workspace.fs.writeFile(vscode.Uri.file(grant.path), bytes);
            await webviewPanel.webview.postMessage({ type: "fileResult", requestId: msg.requestId, success: true });
          }
        } catch (error) {
          await webviewPanel.webview.postMessage({ type: "fileResult", requestId: msg.requestId, success: false, error: error instanceof Error ? error.message : "Authorized file operation failed" });
        }
        return;
      }
      if (this.sessions.accept(toolPanel, msg)) return;
      if (msg?.type === "saveBlueprint") {
        let replied = false;
        const reply = async (result: ToolResult) => {
          if (replied) return;
          replied = true;
          await webviewPanel.webview.postMessage({ type: "saveBlueprintResult", requestId: msg.requestId, result });
        };
        const result = await this.saveBlueprint(editorId, msg.mode === "saveAs" ? "saveAs" : "save", undefined, undefined, undefined, reply);
        await reply(result);
        return;
      }
      if (msg?.type === "blueprintEditorReady") {
        this.router.registry.updateReadyState(toolPanel, msg.stamp);
        for (const ready of [...this.readyWaiters.get(document.uri.toString()) ?? []]) ready(liveEditor);
        return;
      }
      if (msg?.type === "blueprintToolResponse") {
        this.router.acceptResponse(toolPanel, msg);
        return;
      }
      const handledUiMessage = await handleUiPlatformMessage(msg, {
        language: vscode.env.language,
        globalState: this.context.globalState,
        postMessage: (message) => webviewPanel.webview.postMessage(message),
        onLanguageChanged: (language, revision) => {
          this.languageUpdateQueue = this.languageUpdateQueue.then(async () => {
            await Promise.all([...this.panels]
              .map((panel) => panel.webview.postMessage({ type: "uiLanguageChanged", language, revision }).then(() => undefined)));
          });
          return this.languageUpdateQueue;
        },
      });
      if (handledUiMessage) return;

      switch (msg.type) {
        case "ready":
          sendDocument();
          break;

        case "save": {
          const edit = new vscode.WorkspaceEdit();
          await saveQueue.run(() => saveDocument(msg, {
            replace: (content) => edit.replace(
              document.uri,
              new vscode.Range(0, 0, document.lineCount, 0),
              content,
            ),
            applyEdit: () => vscode.workspace.applyEdit(edit),
            save: () => document.save(),
            postMessage: (message) => webviewPanel.webview.postMessage(message),
          }));
          break;
        }

        case "saveAs": {
          let replied = false;
          const reply = async (result: ToolResult) => {
            if (replied) return;
            replied = true;
            await webviewPanel.webview.postMessage({ type: "fileResult", requestId: msg.requestId, success: result.ok,
              ...(result.ok ? {} : { error: result.error.message }) });
          };
          const result = await this.saveBlueprint(editorId, "saveAs", undefined, undefined, msg.path, reply);
          await reply(result);
          break;
        }

        case "showSaveDialog": {
          const filters: Record<string, string[]> = {};
          for (const f of msg.filters || []) {
            filters[f.name] = f.extensions;
          }
          const uri = await vscode.window.showSaveDialog({
            filters,
            defaultUri: msg.defaultPath ? vscode.Uri.file(msg.defaultPath) : undefined,
          });
          webviewPanel.webview.postMessage({
            type: "dialogResult",
            requestId: msg.requestId,
            path: uri?.fsPath || null,
          });
          break;
        }

        case "showOpenDialog": {
          const filters: Record<string, string[]> = {};
          for (const f of msg.filters || []) {
            filters[f.name] = f.extensions;
          }
          const uris = await vscode.window.showOpenDialog({
            filters,
            canSelectMany: msg.multiple || false,
          });
          webviewPanel.webview.postMessage({
            type: "dialogResult",
            requestId: msg.requestId,
            path: uris?.[0]?.fsPath || null,
          });
          break;
        }

        case "writeFile": {
          try {
            const uri = vscode.Uri.file(msg.path);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(msg.data, "base64"));
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: true,
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: false,
              error: e.message,
            });
          }
          break;
        }

        case "readFile": {
          try {
            const uri = vscode.Uri.file(msg.path);
            const data = await vscode.workspace.fs.readFile(uri);
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: true,
              data: Buffer.from(data).toString("base64"),
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: false,
              error: e.message,
            });
          }
          break;
        }

        case "getAutosaveDir": {
          const docDir = path.dirname(document.uri.fsPath);
          // Don't nest backups: if the open document already lives inside a
          // .pindou_autosave folder (e.g. the user opened a backup to recover),
          // reuse that folder instead of stacking .pindou_autosave/.pindou_autosave/...
          const dir =
            path.basename(docDir) === ".pindou_autosave"
              ? docDir
              : path.join(docDir, ".pindou_autosave");
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          webviewPanel.webview.postMessage({
            type: "fileResult",
            requestId: msg.requestId,
            success: true,
            data: dir,
          });
          break;
        }

        case "listSnapshots": {
          try {
            const dirPath = String(msg.dir ?? "");
            const items: Array<{ path: string; name: string; modified: string; mtimeMs: number }> = [];
            if (dirPath && fs.existsSync(dirPath)) {
              for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pindou")) continue;
                const full = path.join(dirPath, entry.name);
                const stat = fs.statSync(full);
                const d = new Date(stat.mtimeMs);
                const pad = (n: number) => String(n).padStart(2, "0");
                const modified = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                items.push({
                  path: full,
                  name: entry.name.replace(/\.pindou$/i, ""),
                  modified,
                  mtimeMs: stat.mtimeMs,
                });
              }
              items.sort((a, b) => b.mtimeMs - a.mtimeMs);
            }
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: true,
              data: items.map(({ mtimeMs: _m, ...rest }) => rest),
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: false,
              error: e.message,
            });
          }
          break;
        }

        case "deleteSnapshot": {
          try {
            const target = String(msg.path ?? "");
            // Safety: only allow deletes of .pindou files living directly
            // inside a .pindou_autosave directory. Mirrors the Tauri command's
            // canonicalize+starts_with check.
            if (!target.toLowerCase().endsWith(".pindou")) {
              throw new Error("Refusing to delete: not a .pindou file");
            }
            if (path.basename(path.dirname(target)) !== ".pindou_autosave") {
              throw new Error("Refusing to delete: path is outside .pindou_autosave");
            }
            fs.unlinkSync(target);
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: true,
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: false,
              error: e.message,
            });
          }
          break;
        }

        case "info":
          vscode.window.showInformationMessage(msg.message);
          break;

        case "error":
          vscode.window.showErrorMessage(msg.message);
          break;

        case "getGitHubToken": {
          try {
            // Use VS Code's built-in GitHub authentication
            // createIfNone: true prompts user to sign in if not already
            const session = await vscode.authentication.getSession(
              "github",
              ["gist"],
              { createIfNone: msg.createIfNone ?? false },
            );
            webviewPanel.webview.postMessage({
              type: "githubToken",
              requestId: msg.requestId,
              token: session?.accessToken || null,
              account: session ? { label: session.account.label, id: session.account.id } : null,
            });
          } catch (e: any) {
            webviewPanel.webview.postMessage({
              type: "githubToken",
              requestId: msg.requestId,
              token: null,
              account: null,
              error: e.message,
            });
          }
          break;
        }

        case "clearGitHubToken": {
          // VS Code doesn't have a direct "logout" — we just tell the webview to clear
          webviewPanel.webview.postMessage({
            type: "githubTokenCleared",
            requestId: msg.requestId,
          });
          break;
        }

        case "newProject": {
          // Webview requested a fresh untitled project (e.g., toolbar "新建" button).
          // Mirror the pindouverse.newProject command so the new tab carries an
          // untitled_<ts>.pindou path — never the previously opened file's path.
          try {
            await this.createUntitled(this.context, msg.width, msg.height);
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to create new project: ${e.message}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      this.fileAccess.revokeEditor(editorId);
      liveEditor.abortSave?.();
      this.liveEditors.delete(editorId);
      this.sessions.disposePanel(toolPanel);
      this.router.disposePanel(toolPanel);
      changeDocSub.dispose();
      viewStateSub.dispose();
      panelSub.dispose();
      if (activePindouWebview === webviewPanel) activePindouWebview = undefined;
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");

    // Vite builds a single IIFE bundle with deterministic filenames
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "assets", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "assets", "style.css"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh" style="height:100%;margin:0;padding:0;overflow:hidden">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src https://api.github.com https://gist.githubusercontent.com;">
  <link rel="stylesheet" href="${styleUri}">
  <title>PindouVerse</title>
  <style>html,body{height:100%;margin:0;padding:0;overflow:hidden}#root{height:100%;overflow:hidden}#root>div{height:100%!important;max-height:100%!important}</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
