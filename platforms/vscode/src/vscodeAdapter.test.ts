import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postedMessages: Array<Record<string, unknown>> = [];
let testWindow: EventTarget;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  postedMessages.length = 0;
  testWindow = new EventTarget();
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage(message: Record<string, unknown>) {
      postedMessages.push(message);
    },
    getState: () => undefined,
    setState: () => undefined,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function adapterModule() {
  return import("./vscodeAdapter");
}

function replyTo(index: number, payload: Record<string, unknown>) {
  const requestId = postedMessages[index].requestId;
  testWindow.dispatchEvent(new MessageEvent("message", {
    data: { requestId, ...payload },
  }));
}

describe("VS Code in-place save RPC", () => {
  it.each([
    { type: "blueprintToolRequest", toolRequestId: "tool:session:1" },
    { type: "saveResult", success: true },
    { type: "fileResult", toolRequestId: "tool:session:1", data: "wrong" },
    { type: "fileResult", handoffId: "handoff:session:1", data: "wrong" },
  ])("ignores an unrelated inbound reply %j", async (message) => {
    const { sendRequest } = await adapterModule();
    let settled = false;
    const pending = sendRequest("readFile", { path: "/test.png" });
    void pending.then(() => { settled = true; });
    replyTo(0, message);
    await Promise.resolve();
    expect(settled).toBe(false);
    replyTo(0, { type: "fileResult", data: "validated-bytes" });
    await expect(pending).resolves.toMatchObject({ data: "validated-bytes" });
  });

  it("waits for the host save result and carries a requestId", async () => {
    const { VScodeAdapter } = await adapterModule();
    testWindow.dispatchEvent(new MessageEvent("message", { data: { type: "loadDocument", content: "{}", path: "/current.pindou" } }));
    const request = new VScodeAdapter().saveProject("/current.pindou", { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]] } as any);

    expect(postedMessages[0]).toMatchObject({ type: "save", requestId: 1 });
    replyTo(0, { type: "saveResult", success: true });
    await expect(request).resolves.toBeUndefined();
  });

  it("rejects failed and timed-out host saves", async () => {
    const { VScodeAdapter } = await adapterModule();
    testWindow.dispatchEvent(new MessageEvent("message", { data: { type: "loadDocument", content: "{}", path: "/current.pindou" } }));
    const adapter = new VScodeAdapter();
    const failed = adapter.saveProject("/current.pindou", { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]] } as any);
    replyTo(0, { type: "saveResult", success: false, error: "disk full" });
    await expect(failed).rejects.toThrow("disk full");

    const timedOut = adapter.saveProject("/current.pindou", { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]] } as any);
    const rejection = expect(timedOut).rejects.toThrow("VS Code request save timed out");
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
  });
});

describe("VS Code RPC timeout classification", () => {
  it.each(["success", "cancelled"] as const)("waits for a deferred blueprint save dialog and completes %s exactly once", async outcome => {
    const { sendRequest } = await adapterModule();
    const resolved = vi.fn();
    const rejected = vi.fn();
    const request = sendRequest("saveBlueprint", { mode: "saveAs" });
    void request.then(resolved, rejected);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(resolved).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    replyTo(0, { type: "saveResult", success: true });
    replyTo(0, { type: "saveBlueprintResult", toolRequestId: "tool:session:1" });
    replyTo(0, { type: "saveBlueprintResult", handoffId: "handoff:session:1" });
    replyTo(0, { type: "saveBlueprintResult", requestId: String(postedMessages[0].requestId) });
    await vi.advanceTimersByTimeAsync(121_000);
    expect(resolved).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();

    const result = outcome === "success" ? { ok: true, value: { path: "/saved.pindou" } }
      : { ok: false, error: { code: "cancelled" } };
    replyTo(0, { type: "saveBlueprintResult", result });
    await expect(request).resolves.toMatchObject({ result });
    expect(resolved).toHaveBeenCalledOnce();
    expect(rejected).not.toHaveBeenCalled();
    expect(postedMessages).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    const readDuplicate = vi.fn();
    const duplicate = { type: "saveBlueprintResult", requestId: postedMessages[0].requestId };
    Object.defineProperty(duplicate, "error", { get: readDuplicate });
    testWindow.dispatchEvent(new MessageEvent("message", { data: duplicate }));
    expect(readDuplicate).not.toHaveBeenCalled();
    expect(resolved).toHaveBeenCalledOnce();
  });

  it("rejects a pending blueprint save on unload instead of timing out its dialog", async () => {
    const { sendRequest } = await adapterModule();
    const rejected = vi.fn();
    const request = sendRequest("saveBlueprint");
    void request.catch(rejected);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(rejected).not.toHaveBeenCalled();
    testWindow.dispatchEvent(new Event("unload"));
    await expect(request).rejects.toThrow("VS Code webview unloaded");
    expect(rejected).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    replyTo(0, { type: "saveBlueprintResult", result: { ok: true } });
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledOnce();
  });

  it("allows readFile to resolve after five seconds", async () => {
    const { sendRequest } = await adapterModule();
    const request = sendRequest("readFile", { path: "/large.pindou" });

    await vi.advanceTimersByTimeAsync(6_000);
    replyTo(0, { type: "fileResult", data: "ok" });

    await expect(request).resolves.toMatchObject({ data: "ok" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a large export write to resolve within 120 seconds", async () => {
    const { sendRequest } = await adapterModule();
    const request = sendRequest("writeFile", { path: "/large.png", operation: "export" });

    await vi.advanceTimersByTimeAsync(61_000);
    replyTo(0, { type: "fileResult", success: true });

    await expect(request).resolves.toMatchObject({ success: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["listSnapshots", "getAutosaveDir"])(
    "allows slow metadata operation %s to resolve after five seconds",
    async (type) => {
      const { sendRequest } = await adapterModule();
      const request = sendRequest(type);

      await vi.advanceTimersByTimeAsync(6_000);
      replyTo(0, { type: "fileResult", data: "ok" });

      await expect(request).resolves.toMatchObject({ data: "ok" });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["showOpenDialog", "showSaveDialog"])(
    "does not time out file dialog %s",
    async (type) => {
      const { sendRequest } = await adapterModule();
      const request = sendRequest(type);

      await vi.advanceTimersByTimeAsync(121_000);
      replyTo(0, { type: "dialogResult", path: null });

      await expect(request).resolves.toMatchObject({ path: null });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["storageGet", "getUiEnvironment"])(
    "times out bootstrap operation %s at five seconds and removes it from pending requests",
    async (type) => {
      const { sendRequest } = await adapterModule();
      const request = sendRequest(type);
      const rejection = expect(request).rejects.toThrow(`VS Code request ${type} timed out`);

      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
      expect(vi.getTimerCount()).toBe(0);

      const lateReply = { requestId: postedMessages[0].requestId } as Record<string, unknown>;
      Object.defineProperty(lateReply, "error", {
        get: () => { throw new Error("timed-out request remained pending"); },
      });
      expect(() => testWindow.dispatchEvent(new MessageEvent("message", { data: lateReply }))).not.toThrow();
    },
  );
});
