import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BlueprintEditorRegistry, BlueprintToolRouter } from "./blueprintTools";

afterEach(() => vi.useRealTimers());

function setupRouter() {
  const first = { postMessage: vi.fn(async (_message: unknown) => true) };
  const second = { postMessage: vi.fn(async (_message: unknown) => true) };
  const registry = new BlueprintEditorRegistry();
  const firstId = registry.registerPanel(first, "first.pindou");
  const secondId = registry.registerPanel(second, "second.pindou");
  registry.updateReadyState(first, { editorId: firstId, projectGeneration: 1, revision: 2, isDirty: true, activeLayerId: "layer-1" });
  registry.updateReadyState(second, { editorId: secondId, projectGeneration: 1, revision: 2, isDirty: true, activeLayerId: "layer-2" });
  const router = new BlueprintToolRouter(registry, () => firstId, () => true);
  return { registry, router, first, second, firstId };
}

it("accepts a matching response only from the originating panel", async () => {
  const { router, first, second, firstId } = setupRouter();
  let settled = false;
  const pending = router.invoke("inspect_blueprint", {}, new AbortController().signal);
  void pending.then(() => { settled = true; });
  const request = first.postMessage.mock.calls[0][0] as Record<string, unknown>;
  const response = { type: "blueprintToolResponse", toolRequestId: request.toolRequestId, editorId: firstId, projectGeneration: 1,
    result: { ok: true, stamp: { editorId: firstId, projectGeneration: 1, revision: 2, isDirty: true, activeLayerId: "layer-1" }, summary: "Read", value: {} } };
  router.acceptResponse(second, response);
  await Promise.resolve();
  expect(settled).toBe(false);
  router.acceptResponse(first, response);
  await expect(pending).resolves.toMatchObject({ ok: true });
  router.dispose();
});

it("rejects pending requests when their editor is closed", async () => {
  const { router, first } = setupRouter();
  const pending = router.invoke("inspect_blueprint", {}, new AbortController().signal);
  router.disposePanel(first);
  await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "editor_closed" } });
  router.dispose();
});

it("reports an unacknowledged write as unknown without retrying", async () => {
  vi.useFakeTimers();
  const { router, first, firstId } = setupRouter();
  const pending = router.invoke("set_beads", { editorId: firstId, projectGeneration: 1, layerId: "layer-1", beads: [{ x: 0, y: 0, color: null }] }, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(30_000);
  await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "outcome_unknown" } });
  expect(first.postMessage.mock.calls.filter(([message]) => (message as { type: string }).type === "blueprintToolRequest")).toHaveLength(1);
  router.dispose();
});

it("requires a host with Stable Agent tool integration", () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
  expect(manifest.engines.vscode).toBe("^1.99.0");
  expect(manifest.devDependencies["@types/vscode"]).toBe("1.99.0");
});