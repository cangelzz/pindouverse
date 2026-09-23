import { TOOL_LIMITS, toolFailure, type EditorStamp, type ToolResult } from "../../../src/blueprint/toolContract";
import type { ProjectFile } from "../../../src/types";
import type { EditorSessionSnapshot } from "../../../src/types";
import type { BlueprintPanel } from "./blueprintTools";
import { randomUUID } from "node:crypto";

export class SessionChannel {
  private readonly pending = new Map<string, { panel: BlueprintPanel; type: string; finish(value?: unknown, error?: Error): void }>();

  request(panel: BlueprintPanel, type: string, ownerId: string, data: Record<string, unknown> = {}): Promise<unknown> {
    const handoffId = `handoff:${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(undefined, new Error("Session acknowledgement timed out")), TOOL_LIMITS.handoffTimeoutMs);
      const finish = (value?: unknown, error?: Error) => {
        if (!this.pending.delete(handoffId)) return;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      this.pending.set(handoffId, { panel, type: `${type}Result`, finish });
      Promise.resolve(panel.postMessage({ ...data, type, handoffId, ownerId })).then(sent => {
        if (!sent) finish(undefined, new Error("Session message was not delivered"));
      }, error => finish(undefined, error));
    });
  }

  accept(panel: BlueprintPanel, message: unknown): boolean {
    if (!message || typeof message !== "object") return false;
    const reply = message as Record<string, unknown>;
    if (typeof reply.handoffId !== "string" || "requestId" in reply || "toolRequestId" in reply) return false;
    const pending = this.pending.get(reply.handoffId);
    if (!pending || pending.panel !== panel || pending.type !== reply.type) return false;
    if (Buffer.byteLength(JSON.stringify(message)) > TOOL_LIMITS.sessionBytes) pending.finish(undefined, new Error("Session reply exceeded transfer limit"));
    else pending.finish(reply.value, reply.error ? new Error(String(reply.error)) : undefined);
    return true;
  }

  disposePanel(panel: BlueprintPanel): void {
    for (const pending of this.pending.values()) if (pending.panel === panel) pending.finish(undefined, new Error("Editor closed during session transfer"));
  }
}

export interface SavedBlueprint { project: ProjectFile; savedRevision: number; }
export interface HandoffDependencies {
  selectDestination(): Promise<string | null>;
  capture(): Promise<SavedBlueprint>;
  write(path: string, saved: SavedBlueprint): Promise<void>;
  lock(): Promise<EditorSessionSnapshot>;
  restore(path: string, snapshot: EditorSessionSnapshot, saved: SavedBlueprint): Promise<EditorStamp>;
  finalize(saved: SavedBlueprint): Promise<void>;
  enable(): Promise<void>;
  beforeRetire?(result: ToolResult): Promise<void>;
  disposeSource(): void;
  abortDestination(): Promise<void>;
  releaseSource(): Promise<void>;
}
export class SaveHandoffCoordinator {
  phase: "prepare" | "write" | "capture" | "restore" | "commit" | "complete" | "aborted" = "prepare";
  constructor(private readonly dependencies: HandoffDependencies) {}
  async run(signal: AbortSignal): Promise<ToolResult> {
    if (this.phase !== "prepare") return toolFailure("editor_busy", "Save handoff already started");
    let destination: string | null = null;
    let saved: SavedBlueprint | undefined;
    let fileWritten: boolean | null = false;
    const checkCancelled = () => { if (signal.aborted) throw new Error("Save was cancelled"); };
    try {
      checkCancelled();
      destination = await this.dependencies.selectDestination();
      if (!destination) {
        this.phase = "aborted";
        return toolFailure("cancelled", "Save dialog was cancelled");
      }
      checkCancelled();
      saved = await this.dependencies.capture();
      checkCancelled();
      this.phase = "write";
      fileWritten = null;
      await this.dependencies.write(destination, saved);
      fileWritten = true;
      checkCancelled();
      this.phase = "capture";
      const snapshot = await this.dependencies.lock();
      checkCancelled();
      this.phase = "restore";
      const stamp = await this.dependencies.restore(destination, snapshot, saved);
      checkCancelled();
      this.phase = "commit";
      await this.dependencies.finalize(saved);
      checkCancelled();
      await this.dependencies.enable();
      this.phase = "complete";
      const result: ToolResult = { ok: true, stamp, summary: "Saved blueprint and transferred the live editor session",
        value: { path: destination, savedRevision: saved.savedRevision, fileWritten: true } };
      await this.dependencies.beforeRetire?.(result);
      this.dependencies.disposeSource();
      return result;
    } catch (error) {
      if (this.phase === "complete") return toolFailure("outcome_unknown", "Ownership transferred but source cleanup failed; inspect the destination", { path: destination, fileWritten });
      this.phase = "aborted";
      const cleanup = await Promise.allSettled([this.dependencies.abortDestination(), this.dependencies.releaseSource()]);
      const cleanupFailed = cleanup.some(result => result.status === "rejected");
      const message = error instanceof Error ? error.message : "Save handoff failed";
      const details = { path: destination, fileWritten, savedRevision: saved?.savedRevision, cleanupFailed };
      if (fileWritten) return toolFailure("save_handoff_failed", message, details);
      if (fileWritten === null) return toolFailure("outcome_unknown", "File write could not be confirmed; inspect before retrying", details);
      return toolFailure(signal.aborted ? "cancelled" : "io_error", message, details);
    }
  }
}