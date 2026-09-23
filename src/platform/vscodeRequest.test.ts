import { afterEach, describe, expect, it, vi } from "vitest";

async function loadAdapter() {
  const windowLike = new EventTarget();
  const postMessage = vi.fn();
  vi.stubGlobal("window", windowLike);
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage, getState: () => undefined, setState: () => undefined }));
  vi.resetModules();
  const adapter = await import("../../platforms/vscode/src/vscodeAdapter");
  return { ...adapter, windowLike, postMessage };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function dispatchReply(windowLike: EventTarget, requestId: number, data: Record<string, unknown> = {}) {
  const event = new Event("message");
  Object.defineProperty(event, "data", { value: { requestId, ...data } });
  windowLike.dispatchEvent(event);
}

describe("VS Code sendRequest", () => {
  it("lets an open dialog resolve after the bootstrap timeout window", async () => {
    vi.useFakeTimers();
    const { sendRequest, windowLike } = await loadAdapter();
    const request = sendRequest("showOpenDialog");
    let settled = false;
    void request.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(5_001);
    expect(settled).toBe(false);
    dispatchReply(windowLike, 1, { type: "dialogResult", path: "/chosen.pindou" });

    await expect(request).resolves.toMatchObject({ path: "/chosen.pindou" });
    expect(vi.getTimerCount()).toBe(0);
  }, 10_000);

  it("times out bootstrap RPCs after five seconds and cleans pending state", async () => {
    vi.useFakeTimers();
    const { sendRequest, postMessage, windowLike } = await loadAdapter();
    const request = sendRequest("getUiEnvironment");
    const rejection = expect(request).rejects.toThrow("timed out");
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "getUiEnvironment", requestId: 1 }));

    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);

    // A late host response must be ignored after timeout cleanup.
    dispatchReply(windowLike, 1, { type: "uiEnvironment", language: "zh-CN" });
  });

  it.each([
    ["ordinary writes", "writeFile", { path: "/project.pindou" }, 120_000],
    ["exports", "writeFile", { path: "/project.png", operation: "export" }, 120_000],
    ["autosave writes", "writeFile", { path: "/backup/autosave.pindou" }, 120_000],
  ])("times out %s after its classified deadline", async (_label, type, data, timeoutMs) => {
    vi.useFakeTimers();
    const { sendRequest } = await loadAdapter();
    const request = sendRequest(type, data);
    const outcome = request.then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );

    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).error).toMatchObject({ message: expect.stringContaining("timed out") });
    expect(vi.getTimerCount()).toBe(0);
  }, 10_000);

  it("does not impose a fixed timeout on GitHub login", async () => {
    vi.useFakeTimers();
    const { sendRequest, windowLike } = await loadAdapter();
    const request = sendRequest("getGitHubToken", { createIfNone: true });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    dispatchReply(windowLike, 1, { type: "githubToken", token: "token" });

    await expect(request).resolves.toMatchObject({ token: "token" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects pending requests and clears their timers when the webview unloads", async () => {
    vi.useFakeTimers();
    const { sendRequest, windowLike } = await loadAdapter();
    const request = sendRequest("storageGet", { key: "pindou.uiLanguage" });
    windowLike.dispatchEvent(new Event("unload"));
    await expect(request).rejects.toThrow("unloaded");
    expect(vi.getTimerCount()).toBe(0);
  });
});
