import { expect, it, vi } from "vitest";
import { SaveHandoffCoordinator, type HandoffDependencies } from "./saveHandoff";
import type { EditorSessionSnapshot } from "../../../src/store/editorSession";

function fixture() {
  const events: string[] = [];
  const project = { version: 3, projectId: "project", canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: null }]], createdAt: "created", updatedAt: "updated" };
  const dependencies: HandoffDependencies = {
    selectDestination: vi.fn(async () => { events.push("select"); return "/saved.pindou"; }),
    capture: vi.fn(async () => { events.push("capture"); return { project, savedRevision: 1 }; }),
    write: vi.fn(async () => { events.push("write"); }),
    lock: vi.fn(async () => { events.push("lock"); return { project, revision: 2 } as EditorSessionSnapshot; }),
    restore: vi.fn(async (_path, snapshot) => { events.push("restore"); return { editorId: "destination", projectGeneration: 1, revision: snapshot.revision, isDirty: true, activeLayerId: "layer" }; }),
    finalize: vi.fn(async () => { events.push("finalize"); }),
    enable: vi.fn(async () => { events.push("enable"); }),
    disposeSource: vi.fn(() => { events.push("disposeSource"); }),
    abortDestination: vi.fn(async () => { events.push("abortDestination"); }),
    releaseSource: vi.fn(async () => { events.push("releaseSource"); }),
  };
  return { events, dependencies, coordinator: new SaveHandoffCoordinator(dependencies) };
}

it("restores the destination before retiring the source and reports written versus live revisions", async () => {
  const { events, coordinator } = fixture();
  const result = await coordinator.run(new AbortController().signal);
  expect(result).toMatchObject({ ok: true, stamp: { editorId: "destination", revision: 2, isDirty: true }, value: { savedRevision: 1 } });
  expect(events).toEqual(["select", "capture", "write", "lock", "restore", "finalize", "enable", "disposeSource"]);
});

it.each(["lock", "restore", "finalize", "enable"] as const)("keeps the source when %s fails after writing", async phase => {
  const { dependencies, coordinator } = fixture();
  vi.mocked(dependencies[phase]).mockRejectedValueOnce(new Error("failed"));
  const result = await coordinator.run(new AbortController().signal);
  expect(result).toMatchObject({ ok: false, error: { code: "save_handoff_failed", details: { fileWritten: true, savedRevision: 1 } } });
  expect(dependencies.disposeSource).not.toHaveBeenCalled();
  expect(dependencies.releaseSource).toHaveBeenCalledOnce();
  expect(dependencies.abortDestination).toHaveBeenCalledOnce();
});

it("does not write after a cancelled destination dialog", async () => {
  const { dependencies, coordinator } = fixture();
  vi.mocked(dependencies.selectDestination).mockResolvedValueOnce(null);
  expect(await coordinator.run(new AbortController().signal)).toMatchObject({ ok: false, error: { code: "cancelled" } });
  expect(dependencies.write).not.toHaveBeenCalled();
});

it.each(["throw", "reject"] as const)("does not claim rollback when a write produces side effects then %s", async failure => {
  const { dependencies, coordinator } = fixture();
  const files = new Map<string, unknown>();
  vi.mocked(dependencies.write).mockImplementationOnce((path, saved) => {
    files.set(path, saved);
    const error = new Error("Write acknowledgement lost");
    if (failure === "throw") throw error;
    return Promise.reject(error);
  });
  const result = await coordinator.run(new AbortController().signal);
  expect(result).toMatchObject({ ok: false, error: { code: "outcome_unknown", details: {
    path: "/saved.pindou", fileWritten: null, savedRevision: 1,
  } } });
  expect(files.get("/saved.pindou")).toMatchObject({ savedRevision: 1 });
  expect(dependencies.lock).not.toHaveBeenCalled();
  expect(dependencies.restore).not.toHaveBeenCalled();
  expect(dependencies.disposeSource).not.toHaveBeenCalled();
  expect(dependencies.releaseSource).toHaveBeenCalledOnce();
});

it("reports false only when cancelled before dispatching the write", async () => {
  const { dependencies, coordinator } = fixture();
  const controller = new AbortController();
  vi.mocked(dependencies.capture).mockImplementationOnce(async () => {
    controller.abort();
    return { project: {} as EditorSessionSnapshot["project"], savedRevision: 1 };
  });
  expect(await coordinator.run(controller.signal)).toMatchObject({ ok: false, error: {
    code: "cancelled", details: { fileWritten: false },
  } });
  expect(dependencies.write).not.toHaveBeenCalled();
  expect(dependencies.disposeSource).not.toHaveBeenCalled();
});

it("reports an acknowledged write when cancellation happens after writing", async () => {
  const { dependencies, coordinator } = fixture();
  const controller = new AbortController();
  vi.mocked(dependencies.write).mockImplementationOnce(async () => { controller.abort(); });
  expect(await coordinator.run(controller.signal)).toMatchObject({ ok: false, error: {
    code: "save_handoff_failed", details: { fileWritten: true },
  } });
  expect(dependencies.lock).not.toHaveBeenCalled();
  expect(dependencies.disposeSource).not.toHaveBeenCalled();
});