import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

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
  context.subscriptions.push(
    PindouEditorProvider.register(context, createUntitledProject)
  );

  // Command: new project (opens blank canvas immediately, no save dialog)
  context.subscriptions.push(
    vscode.commands.registerCommand("pindouverse.newProject", async () => {
      await createUntitledProject(context);
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
}

export function deactivate() {}

class PindouEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = "pindouverse.editor";

  static register(
    context: vscode.ExtensionContext,
    createUntitled: (ctx: vscode.ExtensionContext, w?: number, h?: number) => Promise<void>
  ): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PindouEditorProvider.viewType,
      new PindouEditorProvider(context, createUntitled),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly createUntitled: (ctx: vscode.ExtensionContext, w?: number, h?: number) => Promise<void>
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
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
        content: document.getText(),
        path: document.uri.fsPath,
        isUntitled,
        isBackup,
      });
    };

    // Suppress reload during save (our own edit triggers onDidChangeTextDocument)
    let isSaving = false;

    // Listen for document changes (external edits)
    const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && !isSaving) {
        sendDocument();
      }
    });

    // Listen for messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          sendDocument();
          break;

        case "save": {
          isSaving = true;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            msg.content
          );
          await vscode.workspace.applyEdit(edit);
          await document.save();
          isSaving = false;
          break;
        }

        case "saveAs": {
          // Write content to the new path, then re-open it in our custom editor.
          // The current webview panel is disposed so the new editor takes over.
          try {
            const newUri = vscode.Uri.file(msg.path);
            await vscode.workspace.fs.writeFile(
              newUri,
              Buffer.from(msg.content, "utf8")
            );
            webviewPanel.webview.postMessage({
              type: "fileResult",
              requestId: msg.requestId,
              success: true,
            });
            // Open the freshly saved file in the custom editor (replaces this panel)
            await vscode.commands.executeCommand(
              "vscode.openWith",
              newUri,
              "pindouverse.editor"
            );
            webviewPanel.dispose();
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
      changeDocSub.dispose();
      viewStateSub.dispose();
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src https://api.github.com;">
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
