import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import { TOOL_LIMITS, implementedToolNames, stampSchema, toolDefinitions, toolFailure, toolInputSchemas, toolResponseSchema, type EditorStamp, type ToolName, type ToolResult } from "../../../src/blueprint/toolContract";

export interface BlueprintPanel { postMessage(message: unknown): PromiseLike<boolean>; }
interface EditorRecord { id: string; panel: BlueprintPanel; uri: string; stamp?: EditorStamp; counter: number; saving?: boolean; }

export class BlueprintEditorRegistry {
  private readonly editors = new Map<string, EditorRecord>();

  registerPanel(panel: BlueprintPanel, uri: string): string {
    const id = randomUUID();
    this.editors.set(id, { id, panel, uri, counter: 0 });
    return id;
  }

  updateReadyState(panel: BlueprintPanel, value: unknown): boolean {
    const parsed = stampSchema.safeParse(value);
    if (!parsed.success) return false;
    const editor = this.editors.get(parsed.data.editorId);
    if (!editor || editor.panel !== panel) return false;
    if (editor.stamp && (parsed.data.projectGeneration < editor.stamp.projectGeneration
      || (parsed.data.projectGeneration === editor.stamp.projectGeneration && parsed.data.revision < editor.stamp.revision))) return false;
    editor.stamp = parsed.data;
    return true;
  }

  resolveEditor(id: string | undefined): EditorRecord | undefined { return id ? this.editors.get(id) : undefined; }
  idForUri(uri: string): string | undefined { return [...this.editors.values()].find(editor => editor.uri === uri)?.id; }
  disposePanel(panel: BlueprintPanel): void {
    for (const [id, editor] of this.editors) if (editor.panel === panel) this.editors.delete(id);
  }
}

interface PendingTool {
  editor: EditorRecord;
  generation: number;
  finish(result: ToolResult): void;
}

export class BlueprintToolRouter {
  testControls?: { waitForEditor(uri: string): Promise<void>; setSaveDestination(path: string | undefined): void; failNextDestination(): void };
  saveHandler?: (editorId: string, expectedRevision: number | undefined, signal: AbortSignal) => Promise<ToolResult>;
  prepareFile?: (editorId: string, operation: "import_image" | "export_blueprint", input: unknown, operationId: string, signal: AbortSignal) => Promise<{ grantId: string; path: string } | ToolResult>;
  releaseFile?: (operationId: string) => void;
  private readonly pending = new Map<string, PendingTool>();
  private readonly writeQueues = new Map<string, Promise<ToolResult>>();
  private readonly queuedCounts = new Map<string, number>();
  private disposed = false;

  constructor(readonly registry: BlueprintEditorRegistry, private readonly selected: () => string | undefined, private readonly trusted: () => boolean) {}

  async invoke(operation: ToolName, input: unknown, signal: AbortSignal): Promise<ToolResult> {
    if (this.disposed || signal.aborted) return toolFailure("cancelled", "Tool request cancelled");
    if (!implementedToolNames.includes(operation)) return toolFailure("invalid_arguments", "Tool is not implemented");
    const parsed = toolInputSchemas[operation].safeParse(input);
    if (!parsed.success) return toolFailure("invalid_arguments", "Tool parameters do not match the schema");
    const parameters = parsed.data;
    const editor = this.registry.resolveEditor(parameters.editorId ?? this.selected());
    if (!editor) return toolFailure(parameters.editorId ? "editor_closed" : "no_editor", "Select an open Pindou editor and inspect it first");
    if (!editor.stamp) return toolFailure("editor_not_ready", "The Pindou editor is still loading");
    const writes = operation !== "inspect_blueprint" && operation !== "search_palette";
    if (writes && !this.trusted()) return toolFailure("permission_denied", "Agent writes require a trusted workspace");
    if ("projectGeneration" in parameters && parameters.projectGeneration !== editor.stamp.projectGeneration)
      return toolFailure("stale_revision", "The project identity changed; inspect it again");
    const generation = editor.stamp.projectGeneration;
    const count = this.queuedCounts.get(editor.id) ?? 0;
    if (count >= TOOL_LIMITS.pendingPerEditor) return toolFailure("limit_exceeded", "Too many pending editor requests");
    this.queuedCounts.set(editor.id, count + 1);
    const dispatch = () => this.dispatch(editor, generation, operation, parameters, writes, signal);
    const previous = writes ? this.writeQueues.get(editor.id) : undefined;
    const current = previous ? previous.then(dispatch) : dispatch();
    if (writes) this.writeQueues.set(editor.id, current);
    try { return await current; }
    finally {
      const remaining = (this.queuedCounts.get(editor.id) ?? 1) - 1;
      if (remaining) this.queuedCounts.set(editor.id, remaining); else this.queuedCounts.delete(editor.id);
      if (this.writeQueues.get(editor.id) === current) this.writeQueues.delete(editor.id);
    }
  }

  private async dispatch(editor: EditorRecord, generation: number, operation: ToolName, input: unknown, writes: boolean, signal: AbortSignal): Promise<ToolResult> {
    if (this.disposed || signal.aborted) return Promise.resolve(toolFailure("cancelled", "Tool request cancelled"));
    if (this.registry.resolveEditor(editor.id) !== editor) return Promise.resolve(toolFailure("editor_closed", "The editor closed"));
    if (generation !== editor.stamp?.projectGeneration) return Promise.resolve(toolFailure("stale_revision", "The project changed while waiting"));
    if (writes && !this.trusted()) return Promise.resolve(toolFailure("permission_denied", "Workspace trust changed"));
    if (writes && editor.saving) return Promise.resolve(toolFailure("editor_busy", "An editor save is in progress"));
    if (operation === "save_blueprint" && this.saveHandler) {
      return this.saveHandler(editor.id, (input as { expectedRevision?: number }).expectedRevision, signal);
    }
    const toolRequestId = `tool:${editor.id}:${++editor.counter}`;
    let fileAccess: { grantId: string; path: string } | undefined;
    if (operation === "import_image" || operation === "export_blueprint") {
      if (!this.prepareFile) return toolFailure("permission_denied", "File authorization is unavailable");
      try {
        const prepared = await this.prepareFile(editor.id, operation, input, toolRequestId, signal);
        if ("ok" in prepared) return prepared;
        fileAccess = prepared;
        input = { ...input as object, path: prepared.path };
      } catch { return toolFailure("permission_denied", "File access was not authorized"); }
      if (signal.aborted || this.registry.resolveEditor(editor.id) !== editor || editor.stamp?.projectGeneration !== generation) {
        this.releaseFile?.(toolRequestId);
        return toolFailure(signal.aborted ? "cancelled" : "stale_revision", "Editor changed during file selection");
      }
    }
    const correlation = { toolRequestId, editorId: editor.id, projectGeneration: generation };
    const request = { type: "blueprintToolRequest", ...correlation, operation, input, ...(fileAccess ? { fileAccess } : {}) };
    if (Buffer.byteLength(JSON.stringify(request)) > TOOL_LIMITS.toolRequestBytes) return Promise.resolve(toolFailure("limit_exceeded", "Tool request too large"));
    return new Promise(resolve => {
      let completed = false;
      const finish = (result: ToolResult) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        this.pending.delete(toolRequestId);
        this.releaseFile?.(toolRequestId);
        resolve(result);
      };
      const cancel = () => {
        void Promise.resolve(editor.panel.postMessage({ type: "blueprintToolCancel", ...correlation })).catch(() => undefined);
        finish(toolFailure(writes ? "outcome_unknown" : "cancelled", writes
          ? "Cancellation followed dispatch; inspect before retrying" : "Tool request cancelled"));
      };
      const timer = setTimeout(() => {
        void Promise.resolve(editor.panel.postMessage({ type: "blueprintToolCancel", ...correlation })).catch(() => undefined);
        finish(toolFailure("outcome_unknown", "Editor acknowledgement timed out; inspect before retrying"));
      }, fileAccess ? TOOL_LIMITS.mediaTimeoutMs : TOOL_LIMITS.toolTimeoutMs);
      this.pending.set(toolRequestId, { editor, generation, finish });
      signal.addEventListener("abort", cancel, { once: true });
      Promise.resolve(editor.panel.postMessage(request)).then(delivered => {
        if (!delivered) finish(toolFailure("editor_not_ready", "The editor did not receive the request"));
      }, () => finish(toolFailure("outcome_unknown", "Editor delivery failed; inspect before retrying")));
    });
  }

  acceptResponse(panel: BlueprintPanel, message: unknown): void {
    const parsed = toolResponseSchema.safeParse(message);
    if (!parsed.success) return;
    const response = parsed.data;
    const pending = this.pending.get(response.toolRequestId);
    if (!pending || pending.editor.panel !== panel || pending.editor.id !== response.editorId || pending.generation !== response.projectGeneration) return;
    if (response.result.ok && (response.result.stamp.editorId !== pending.editor.id || response.result.stamp.projectGeneration !== pending.generation)) return;
    if (Buffer.byteLength(JSON.stringify(response)) > TOOL_LIMITS.responseBytes) {
      pending.finish(toolFailure("limit_exceeded", "Editor response too large"));
      return;
    }
    if (response.result.ok) this.registry.updateReadyState(panel, response.result.stamp);
    pending.finish(response.result);
  }

  disposePanel(panel: BlueprintPanel): void {
    this.registry.disposePanel(panel);
    for (const pending of this.pending.values()) if (pending.editor.panel === panel)
      pending.finish(toolFailure("editor_closed", "Editor closed before acknowledgement; do not blindly retry writes"));
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values()) pending.finish(toolFailure("editor_closed", "Extension deactivated"));
  }
}

export function registerBlueprintTools(api: typeof vscode, router: BlueprintToolRouter, testMode = false): vscode.Disposable[] {
  return toolDefinitions.filter(tool => implementedToolNames.includes(tool.name)).map(tool => api.lm.registerTool(`pindouverse_${tool.name}`, {
    prepareInvocation(options) {
      const parsed = toolInputSchemas[tool.name].safeParse(options.input);
      if (!parsed.success) throw new Error("Invalid Pindou tool parameters");
      return {
        invocationMessage: tool.title,
        ...(tool.writes && !testMode ? { confirmationMessages: { title: tool.title,
          message: tool.name === "save_blueprint" || tool.name === "export_blueprint"
            ? `Write the requested Pindou file for editor ${parsed.data.editorId}.`
            : `Modify the live Pindou blueprint in editor ${parsed.data.editorId}. Changes remain unsaved and can be undone.` } } : {}),
      };
    },
    async invoke(options, token) {
      const controller = new AbortController();
      const subscription = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try {
        const result = await router.invoke(tool.name, options.input, controller.signal);
        return new api.LanguageModelToolResult([new api.LanguageModelTextPart(JSON.stringify(result))]);
      } finally { subscription.dispose(); }
    },
  }));
}