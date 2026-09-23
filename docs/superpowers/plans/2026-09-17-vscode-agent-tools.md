# VS Code Blueprint Agent Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits, branches, additional worktrees, or releases without user authorization.

**Goal:** Deliver the 13 approved VS Code Agent tools against the live blueprint, preserving hand edits, layer-correct Undo/Redo, and truthful file outcomes.

**Architecture:** Shared schemas and operation contracts are independent of VS Code. A host registry/router binds explicit editor identities and sends typed messages to a Webview dispatcher, which commits validated editor transactions. Save As uses a host-owned session handoff instead of destroying the calling Webview after writing a file.

**Tech Stack:** TypeScript, React 19, Zustand, VS Code 1.99+ Language Model Tools, existing geometry/import/export services, Zod 4 for shared runtime schemas and JSON Schema generation, image-size 2 for bounded header inspection, Vitest, Playwright, and `@vscode/test-electron`.

---

## Scope And Execution Rules

- Specification: [reviewed design](../specs/2026-09-17-vscode-agent-tools-design.md).
- Worktree: `Q:/repo/pindou/.worktrees/vscode-agent-tools`; branch: `feature/vscode-agent-tools`; baseline: `db34b04e70180cb84561262dfa560a13f983141f`.
- This artifact is a plan, not evidence that the proposed implementation exists or passes. No application code or dependency files are changed while writing it.
- Paths below are relative to this worktree. Run root commands here, not in the original wheel-zoom checkout. Use `npm --prefix platforms/vscode` for extension scripts.
- Use the existing worktree. Do not fetch/merge unrelated changes, publish, bump product versions, or touch the legacy desktop version system during execution.
- The unit-test order is RED, smallest implementation, GREEN, then adjacent regression checks. A missing test runner or import-resolution error is an environment blocker, not the expected behavioral RED.
- After each numbered task, inspect the diff and leave changes uncommitted. Finish prerequisite tasks before extending the next tool family; no registered tool may point to an unimplemented handler.
- Do not replace existing editor actions with an Agent-only history stack. All existing manual and Agent edits share the same project history and revision rules.
- Keep VS Code imports and registration out of shared/browser bundles. This phase implements extension tools, not MCP transport or model calls.

## Ownership And Files

Each new production module below has a corresponding colocated `.test.ts` unless the existing tests named in its task are a suitable home. Do not add a second general-purpose test harness.

| Path | Responsibility |
| --- | --- |
| `src/types/index.ts` | Layer-bound cell and reversible project-patch history types. |
| `src/store/editorStore.ts` | Atomic commits, revision/history integration, persistent actions, and session mutation gate. |
| `src/store/editorHistory.ts` (new) | Pure, validated Undo/Redo application and stroke grouping. |
| `src/blueprint/toolContract.ts` (new) | Tool schemas, typed operation union, limits, wire envelopes, and result types. |
| `src/blueprint/toolDispatcher.ts` (new) | Allowlisted synchronous tools, live-state guards, and atomic mutations. |
| `src/blueprint/toolMedia.ts` (new) | Bounded import/export orchestration using injected existing platform services. |
| `src/store/editorSession.ts` (new) | Serializable live-session capture/restore with reversible history and saved baseline. |
| `platforms/vscode/src/blueprintTools.ts` (new) | Editor registry, targeted request router, tool registration, and lifecycle cleanup. |
| `platforms/vscode/src/blueprintFileAccess.ts` (new) | Host-owned, operation-scoped file grants, canonical path and size checks. |
| `platforms/vscode/src/saveHandoff.ts` (new) | Save As state machine with explicit file and ownership outcomes. |
| `platforms/vscode/src/vscodeAdapter.ts` | Typed legacy reply matching and invocation-scoped file-service access. |
| `platforms/vscode/src/extension.ts` | Wire registrations, live panel lifecycle, file policy, and handoff coordinator. |
| `platforms/vscode/webview/main.tsx` | Install the production dispatcher, readiness handshake, and session-transfer receiver. |
| `platforms/vscode/scripts/sync-agent-tools.ts` (new) | Generate static tool contributions from the shared schemas and implemented-tool list. |
| `platforms/vscode/tests/helpers.ts` | Typed tool request helper and distinct source/destination Webview test lifecycles. |
| `platforms/vscode/tests/agent-tools.spec.ts` (new) | Live tool behavior, manual-edit preservation, and all-tool coverage. |
| `platforms/vscode/tests/agent-save-handoff.spec.ts` (new) | Two-session Save As state transfer, dirty state, and failures. |
| `platforms/vscode/tests-e2e/suite/agent-tools.test.ts` (new) | Real registered tools and real panel handoff lifecycle. |

Modify the existing history UI in `src/App.tsx`, geometry helpers in `src/utils/shapeDrawing.ts`, and import/export helpers only when their task requires it. Do not restructure the rest of the application.

## Validation Commands

Commands run from the worktree root unless a task explicitly uses `Push-Location`.

```powershell
npm ci
npm --prefix platforms/vscode ci
npm test -- src/store/projectIntegrity.test.ts src/store/cloudSync.test.ts
npm --prefix platforms/vscode run test:unit
npm --prefix platforms/vscode run check:types
```

Install only when execution starts. Record baseline failures separately and do not fix unrelated tests. The root `npm test -- <path>` invokes Vitest; extension unit discovery is restricted to `platforms/vscode/src/**/*.test.ts`.

For an extension Webview slice, build first and invoke the checked-in Playwright configuration from its own directory:

```powershell
npm --prefix platforms/vscode run build
Push-Location platforms/vscode
npx playwright test agent-tools.spec.ts
Pop-Location
```

## Task 1: Pin The Runtime Boundary And Test Environment

**Depends on:** none.

**Files:** Modify `package.json`, `package-lock.json`, `platforms/vscode/package.json`, and `platforms/vscode/package-lock.json`. Extend `platforms/vscode/src/blueprintTools.test.ts` as the host registration test home.

- [ ] Add this manifest baseline assertion before changing dependencies:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("requires a host with Stable Agent tool integration", () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
  expect(manifest.engines.vscode).toBe("^1.99.0");
  expect(manifest.devDependencies["@types/vscode"]).toBe("1.99.0");
});
```

- [ ] Run `npm --prefix platforms/vscode run test:unit -- src/blueprintTools.test.ts`. Expected RED: engine/type baseline differs, not a missing Vitest installation.
- [ ] Install `npm install zod@^4 --save-exact` at the root and `npm --prefix platforms/vscode install --save-dev --save-exact @types/vscode@1.99.0`. Record the resolved Zod version in the root lockfile. Shared modules resolve Zod from the root and esbuild bundles it into the extension; do not add a second schema dependency or an AI SDK. Set only `engines.vscode` to `^1.99.0`; leave both product version fields untouched.
- [ ] Rerun the manifest assertion and extension type check. Both must pass before continuing. Preserve the existing Windows host-test skip.

## Task 2: Make Cell History Layer-Bound

**Depends on:** Task 1.

**Files:** Modify `src/types/index.ts`, `src/store/editorStore.ts`, and the history display in `src/App.tsx`. Create `src/store/editorHistory.ts`. Extend `src/store/projectIntegrity.test.ts` and existing drawing/selection tests instead of creating another store bootstrap helper.

- [ ] Add this regression inside `projectIntegrity.test.ts`, using its existing initialized `storeModule`:

```ts
it("keeps cell history when switching active layers", () => {
  const store = storeModule.useEditorStore;
  const firstId = store.getState().activeLayerId;
  store.getState().addLayer("Second");
  const secondId = store.getState().activeLayerId;
  store.getState().setActiveLayer(firstId);
  store.getState().setCell(0, 0, 7);
  store.getState().setActiveLayer(secondId);
  store.getState().setCell(0, 0, 8);
  store.getState().setActiveLayer(firstId);
  store.getState().undo();
  expect(store.getState().layers.find(layer => layer.id === firstId)!.data[0][0].colorIndex).toBe(7);
  expect(store.getState().layers.find(layer => layer.id === secondId)!.data[0][0].colorIndex).toBeNull();
  store.getState().redo();
  expect(store.getState().layers.find(layer => layer.id === secondId)!.data[0][0].colorIndex).toBe(8);
});
```

- [ ] Run `npm test -- src/store/projectIntegrity.test.ts -t "keeps cell history"`. Expected RED: active-layer switching currently clears Undo/Redo.
- [ ] Replace the cell action shape and migrate every producer/consumer, not only Agent code:

```ts
export interface CellsHistoryAction {
  kind: "cells";
  changesByLayer: Array<{ layerId: string; entries: HistoryEntry[] }>;
}
```

Single-layer producers emit one group with the captured layer ID. `editorHistory.ts` exports `applyCellsHistory(layers, action, direction)`, returning a new layer array or an error before mutation. It validates every target ID and coordinate first, copies affected layers only, and selects `prevColorIndex` for Undo or `newColorIndex` for Redo. The caller never substitutes `activeLayerId`.

- [ ] Remove history clearing from `setActiveLayer`; reject nonexistent IDs without changing state. Migrate `setCell`, `batchSetCells`, selection move/delete/paste/remap paths, replace-color actions, and `beginStroke`/`endStroke`. Stroke deduplication keys are `${layerId}:${row}:${col}`. Flatten `changesByLayer` only for history UI summaries, never to execute Undo.
- [ ] Add a missing-layer regression by removing a target layer with test setup, then invoking Undo. Assert layers, revision, dirty state, and both history arrays are unchanged. Add Redo and mixed-layer stroke tests in the same store test file.
- [ ] Rerun `npm test -- src/store/projectIntegrity.test.ts src/store/cloudSync.test.ts`; then build and run `drawing.spec.ts`, `selection-actions.spec.ts`, and `undo-host-driven.spec.ts` from the extension directory. Expected GREEN with no cell-history consumer using a bare `action.entries`.

## Task 3: Add Atomic Structural And Configuration Transactions

**Depends on:** Task 2.

**Files:** Modify `src/types/index.ts`, `src/store/editorHistory.ts`, `src/store/editorStore.ts`, and the history display in `src/App.tsx`. Extend `src/store/projectIntegrity.test.ts`.

- [ ] Add a round-trip regression that currently fails because resize clears history:

```ts
it("undoes resize and then the older hand edit", () => {
  const store = storeModule.useEditorStore;
  store.getState().setCell(0, 0, 7);
  const before = storeModule.projectFromEditorState(store.getState(), "2026-01-01T00:00:00Z");
  store.getState().resizeCanvas(2, 2, 0, 0);
  store.getState().undo();
  expect(storeModule.projectFromEditorState(store.getState(), "2026-01-01T00:00:00Z")).toEqual(before);
  store.getState().undo();
  expect(store.getState().canvasData[0][0].colorIndex).toBeNull();
});
```

- [ ] Run `npm test -- src/store/projectIntegrity.test.ts -t "undoes resize"` and confirm behavioral RED.
- [ ] Add a reversible patch history variant instead of wrapping several public actions in several Undo entries:

```ts
export interface ProjectHistoryPatch {
  canvasSize?: CanvasSize;
  layers?: BeadLayer[];
  activeLayerId?: string;
  gridConfig?: GridConfig;
  projectInfo?: ProjectInfo | null;
  nextDefaultLayerNameIndex?: number;
}

export interface ProjectPatchHistoryAction {
  kind: "projectPatch";
  before: ProjectHistoryPatch;
  after: ProjectHistoryPatch;
}
```

`null` represents clearing optional project metadata; omitted patch keys mean unchanged. Add this variant to `HistoryAction`. `editorHistory.ts` validates the prospective patched state; `editorStore.ts` adds `commitProjectPatch(patch)` to compute the before/after fields, preserve immutable layer IDs, recompute the composite, and perform one state commit/history push. This action returns `false` on a no-op and `true` on a committed change. Layer-ID allocation stays monotonic and is not rewound by Undo.

- [ ] Route resize, add/remove/duplicate/merge/reorder layer, visibility/opacity/name changes, grid setters, and project-info updates through the common transaction boundary. Preserve the existing public action signatures. Do not add dirty/revision changes for layer activation or view-only settings. Use one explicit revision increment per commit; the existing subscription must not increment it a second time.
- [ ] Add parameterized Undo/Redo tests for every migrated persistent action; verify deletion restores IDs before an older cell Undo, resize restores grid/dimensions, clearing metadata round-trips, no-ops preserve redo history, and invalid prospective state commits nothing.
- [ ] Run `npm test -- src/store/projectIntegrity.test.ts src/store/cloudSync.test.ts` and extension `layer-merge.spec.ts`, `layer-reorder.spec.ts`, `layer-switcher.spec.ts`, `selection-actions.spec.ts`, and `undo-host-driven.spec.ts`. Expected GREEN before Agent operations use these actions.

## Task 4: Define The Complete Tool Contract Once

**Depends on:** Task 1; can be implemented after Task 3 without delegation.

**Files:** Create `src/blueprint/toolContract.ts` and `src/blueprint/toolContract.test.ts`.

**Identity decision:** Read tools may resolve the selected Pindou editor. Public write schemas require `editorId` and `projectGeneration` from inspection; bead/layer writes also identify their target layer explicitly. Inspection returns `activeLayerId` for the convenient current-layer workflow. This makes the target immutable across `prepareInvocation` and `invoke`, which must not share a mutable "last prepared target" variable. The dispatcher can still support internal active-layer calls, but the published tools use explicit IDs. `expectedRevision` remains optional except when confirming a destructive loss estimate.

- [ ] Add schema tests for every tool, including this RED case before defining the module:

```ts
import { expect, it } from "vitest";
import { toolInputSchemas } from "./toolContract";

it("requires an explicit editor identity for writes", () => {
  expect(toolInputSchemas.set_beads.safeParse({
    layerId: "layer-1", beads: [{ x: 0, y: 0, color: null }],
  }).success).toBe(false);
  expect(toolInputSchemas.inspect_blueprint.safeParse({}).success).toBe(true);
});
```

- [ ] Run `npm test -- src/blueprint/toolContract.test.ts`. Establish RED for the missing contract, then define these shared schema primitives and the tool-specific fields in the table below:

```ts
import { z } from "zod";

export const TOOL_LIMITS = {
  canvasDimension: 256, batchCells: 65_536, inspectCells: 4_096,
  responseBytes: 65_536, toolRequestBytes: 8 * 1024 * 1024,
  imageBytes: 25 * 1024 * 1024, decodedPixels: 16_777_216,
  exportPixels: 16_777_216, outputBytes: 64 * 1024 * 1024,
  pendingPerEditor: 16, toolTimeoutMs: 30_000,
  mediaTimeoutMs: 120_000, handoffTimeoutMs: 30_000,
} as const;

export const editorTargetSchema = z.strictObject({
  editorId: z.string().min(1),
  projectGeneration: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative().optional(),
});
export const pointSchema = z.strictObject({
  x: z.number().int().min(0).max(255),
  y: z.number().int().min(0).max(255),
});
export const rectangleSchema = pointSchema.extend({
  width: z.number().int().min(1).max(256),
  height: z.number().int().min(1).max(256),
});
export const inspectionRegionSchema = rectangleSchema.extend({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});
export const colorSchema = z.string().trim().min(1).max(16);
export const layerTargetSchema = editorTargetSchema.extend({ layerId: z.string().min(1) });
```

The limits are tool safety limits, not changes to ordinary editor capabilities. Validate actual canvas bounds after schema parsing. Existing larger projects may be inspected in bounded regions; reject mutations outside the supported tool dimensions without resizing the user's project.

| Tool key in `toolInputSchemas` | Exact additional fields and defaults |
| --- | --- |
| `inspect_blueprint` | Optional `editorId`; `view: "composite" | "layer"` defaults to composite; optional `layerId` required for layer view; optional `region: inspectionRegionSchema`. No region means metadata/counts only. Read origins are not restricted to the mutation limit; validate them against the actual loaded canvas and cap the returned region to 4,096 cells. |
| `search_palette` | Optional `editorId`; `query` string max 100 defaults to empty; `limit` integer 1..50 defaults to 20. Match code/name or a validated hex query; return calibrated color metadata from the selected editor. |
| `set_beads` | `layerTargetSchema` plus `beads`: array 1..65,536 of `pointSchema.extend({ color: colorSchema.nullable() })`; reject duplicate coordinates. |
| `draw_shape` | `layerTargetSchema`, `color` nullable, and `shape`: strict discriminated union of line `{ kind, start, end }`, rectangle `{ kind, region, filled }`, or circle `{ kind, center, radius, filled }`; radius integer 0..255, filled defaults false. |
| `fill_region` | `layerTargetSchema`, `color` nullable, and `region`: strict union `{ kind: "rectangle", bounds }` or `{ kind: "connected", seed }`. |
| `replace_color` | `editorTargetSchema`, `from` and `to` non-null palette codes, `scope`: `{ kind: "layer", layerId, region? }` or `{ kind: "allLayers" }`. |
| `resize_canvas` | `editorTargetSchema`, `width/height` integers 1..256, `anchorRow/anchorCol` integers 0..2, `allowDataLoss` boolean default false. A true flag also requires `expectedRevision`. |
| `manage_layer` | `editorTargetSchema` plus `change`: strict union with `kind` values add, rename, activate, visibility, opacity, reorder, duplicate, mergeDown, remove. Add has optional `name`; all others require `layerId`. Rename has optional `name` (omission restores default naming where supported); visibility has `visible`; opacity has `opacity` 0..1; reorder has `direction: "up" | "down"`; duplicate has optional `name`; remove has `allowDataLoss` default false and requires outer `expectedRevision` when true. Names are nonblank and max 200. |
| `configure_grid` | `editorTargetSchema` plus nonempty strict `patch`: groupSize integer 1..256, edgePadding integer 0..64, startX/startY integers -10000..10000, visible boolean, lineColor/groupLineColor valid 3/6-digit hex, lineWidth/groupLineWidth numbers 0..8. Every field is optional individually. |
| `update_project_info` | `editorTargetSchema` plus nonempty strict `patch`: title/author max 200, description max 4000, link max 2048 and HTTP(S) or empty; null explicitly clears a field. Omitted fields remain unchanged. |
| `import_image` | `layerTargetSchema`, optional local `path` (omission opens a dialog), `width/height` integers 1..256, `position: pointSchema`, `algorithm: "euclidean" | "ciede2000"` default ciede2000. Use existing palette group/default matching rules; no image-to-project replacement. |
| `export_blueprint` | `editorTargetSchema`, optional destination `path`, `format: "png" | "jpeg"` default png, `cellSize` integer 8..64 default 32. Capture existing grid, export labels, legend, and watermark defaults; enforce final layout pixel budget before allocating a canvas. |
| `save_blueprint` | `editorTargetSchema`; existing project path or the normal first-save dialog determines destination. No raw JSON, arbitrary save target, or implicit autosave. |

- [ ] Build strict Zod objects/unions for all rows, export `ToolName = keyof typeof toolInputSchemas` and `ToolInput<Name> = z.infer<(typeof toolInputSchemas)[Name]>`, and generate JSON schemas with `z.toJSONSchema`. Use refinements only for rules also described to the model; repeat cross-field/state-dependent guards in the dispatcher. Do not emit Zod-only transformations in the published JSON Schema.
- [ ] Define `EditorBinding = { editorId: string; projectGeneration: number }`, `EditorStamp = EditorBinding & { revision: number; isDirty: boolean; activeLayerId: string }`, and the result/envelope contract:

```ts
export type ToolErrorCode =
  | "no_editor" | "ambiguous_editor" | "editor_not_ready" | "editor_closed"
  | "editor_busy" | "invalid_arguments" | "invalid_color" | "invalid_layer"
  | "stale_revision" | "data_loss_confirmation_required" | "cancelled"
  | "io_error" | "save_handoff_failed" | "outcome_unknown"
  | "permission_denied" | "limit_exceeded";

export type ToolResult =
  | { ok: true; stamp: EditorStamp; summary: string; value: unknown }
  | { ok: false; error: { code: ToolErrorCode; message: string; details?: unknown } };

export interface ToolRequest {
  type: "blueprintToolRequest";
  toolRequestId: string;
  editorId: string;
  projectGeneration: number;
  operation: ToolName;
  input: unknown;
}

export interface ToolResponse {
  type: "blueprintToolResponse";
  toolRequestId: string;
  editorId: string;
  projectGeneration: number;
  result: ToolResult;
}
```

Export runtime `toolRequestSchema`, `toolResponseSchema`, and `toolCancelSchema` matching these types; all reject legacy `requestId` and `handoffId`. A cancel has only its discriminator and correlation fields. Error messages must not include file bytes or full documents. File writes returning a new session place the destination stamp in the result, not in the old transport correlation fields.

- [ ] Add invalid coordinates, unknown keys, null-as-empty, invalid color syntax, ambiguous layer scope, destructive flag without revision, byte limits, and all-13 JSON-schema round-trip tests. Run `npm test -- src/blueprint/toolContract.test.ts`; expected GREEN with the same accepted argument shapes in JSON Schema and runtime validation.

## Task 5: Isolate The Existing File RPC Receiver

**Depends on:** Task 4.

**Files:** Modify `platforms/vscode/src/vscodeAdapter.ts`, `platforms/vscode/src/vscodeAdapter.test.ts`, and `platforms/vscode/tests/helpers.ts`. Existing host response discriminators remain unchanged.

- [ ] Add this regression to the existing adapter test bootstrap:

```ts
it("does not consume a file request with an unrelated inbound message", async () => {
  const { sendRequest } = await adapterModule();
  let settled = false;
  const pending = sendRequest("readFile", { path: "/test.png" });
  void pending.then(() => { settled = true; });
  replyTo(0, { type: "blueprintToolRequest", toolRequestId: "tool:session:1" });
  await Promise.resolve();
  expect(settled).toBe(false);
  replyTo(0, { type: "fileResult", data: "validated-bytes" });
  await expect(pending).resolves.toMatchObject({ data: "validated-bytes" });
});
```

- [ ] Run `npm --prefix platforms/vscode run test:unit -- src/vscodeAdapter.test.ts`. Expected RED: the first message currently resolves the file request.
- [ ] Record `expectedType` on each pending legacy request. Export or keep local this explicit request-to-response map; reject unsupported request types at creation instead of accepting any response:

```ts
const replyTypes: Record<string, string> = {
  save: "saveResult", saveAs: "fileResult",
  showSaveDialog: "dialogResult", showOpenDialog: "dialogResult",
  readFile: "fileResult", writeFile: "fileResult", getAutosaveDir: "fileResult",
  listSnapshots: "fileResult", deleteSnapshot: "fileResult",
  getGitHubToken: "githubToken", getUiEnvironment: "uiEnvironment",
  storageGet: "storageResult", storageSet: "storageResult", storageRemove: "storageResult",
};
```

The receiver checks a non-null object, integer ID, absence of tool/handoff IDs, and exact expected discriminator before clearing timers or deleting the pending entry. Preserve existing timeout durations and unlimited dialog waits. Update old adapter tests that deliberately omitted `type` to send the real production response discriminator.

- [ ] Add equal-suffix tool IDs, conflicting ID fields, wrong `saveResult`/`fileResult` types, duplicates, and late-reply tests. Modify the harness to ignore outbound `blueprintToolResponse` and session acknowledgements rather than generically replying to them. All staged file replies retain correct types.
- [ ] Rerun the adapter unit file; build and run `file-ops.spec.ts`, `save-outcomes-i18n.spec.ts`, and `language-lifecycle.spec.ts`. Expected GREEN, including existing startup/UI RPC behavior.

## Task 6: Implement Inspect, Palette Search, And Atomic Bead Writes

**Depends on:** Tasks 2-5.

**Files:** Create `src/blueprint/toolDispatcher.ts`. Extend `src/store/editorStore.ts` and `src/store/projectIntegrity.test.ts`; add operation-focused tests in `src/blueprint/toolDispatcher.test.ts` only for pure parsing/planning that does not need another store bootstrap.

- [ ] Add `batchSetLayerCells(groups)` to the planned store contract. Its groups are `{ layerId, cells: Array<{ row, col, colorIndex }> }`; it validates all layers/coordinates first, commits one `changesByLayer` action, preserves active layer, and returns the changed-cell count. Refactor existing `batchSetCells` to delegate with the active layer, retaining its public signature.
- [ ] Extend the existing store-test initialization to dynamically import the dispatcher after `localStorage` is installed. Add this test, using the new `dispatchBlueprintTool` entry defined immediately below:

```ts
it("tool bead writes retain earlier manual edits and reject a stale retry", async () => {
  const store = storeModule.useEditorStore;
  const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
  const { MARD_COLORS } = await import("../data/mard221");
  store.getState().newCanvas(2, 1);
  store.getState().setCell(0, 0, 7);
  const before = store.getState();
  const binding = { editorId: "editor-1", projectGeneration: before.projectGeneration };
  const input = { ...binding, expectedRevision: before.contentRevision,
    layerId: before.activeLayerId, beads: [{ x: 1, y: 0, color: MARD_COLORS[8].code }] };
  const request = { type: "blueprintToolRequest" as const, toolRequestId: "tool:editor-1:1",
    ...binding, operation: "set_beads" as const, input };
  expect((await dispatchBlueprintTool(request, binding, new AbortController().signal)).ok).toBe(true);
  expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
  const retry = await dispatchBlueprintTool({ ...request, toolRequestId: "tool:editor-1:2" }, binding, new AbortController().signal);
  expect(retry).toMatchObject({ ok: false, error: { code: "stale_revision" } });
  store.getState().undo();
  expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, null]);
});
```

- [ ] Run `npm test -- src/store/projectIntegrity.test.ts -t "tool bead writes"`; expected RED for the missing dispatcher/transaction.
- [ ] Export `dispatchBlueprintTool(request: ToolRequest, binding: EditorBinding, signal: AbortSignal): Promise<ToolResult>`. It parses envelopes/input, checks identity/generation/revision/busy state and cancellation, plans without mutation, and commits synchronously only after all checks succeed. No `await` may appear between the final state guard and a synchronous store commit.
- [ ] Add `getBlueprintBusyReason(): string | null` in the store to expose stroke/floating/adjustment state without exposing private globals. Implement inspect from live layers/composite, including active layer and bounded cell data; implement palette lookup using `MARD_COLORS` and effective color overrides. Resolve codes through a map of actual palette entries, preserving null versus transparent beads.
- [ ] Add operation handlers for the three implemented tools only. Export `implementedToolNames` from the pure `toolContract.ts`, not from the store-dependent dispatcher, and assert handler-key parity in dispatcher tests. For oversized inspection results, return `limit_exceeded` with a smaller-region suggestion rather than silently truncating a rectangle. Test duplicate entries, bad trailing batch item, hidden-layer rejection, no-op history, non-active-layer writes, and unchanged state on every error.
- [ ] Run root contract/store tests and extension type checks. Expected GREEN before connecting Chat or exposing any tool to an Agent.

## Task 7: Connect The Live Editor Registry And Agent Registration

**Depends on:** Tasks 4-6.

**Files:** Create `platforms/vscode/src/blueprintTools.ts`, extend its test file, and create `platforms/vscode/scripts/sync-agent-tools.ts`. Modify `platforms/vscode/src/extension.ts`, `platforms/vscode/webview/main.tsx`, `platforms/vscode/package.json`, `platforms/vscode/tsconfig.host.json`, and `platforms/vscode/tests/helpers.ts`. Create `platforms/vscode/tests/agent-tools.spec.ts`.

- [ ] Define and test a `BlueprintEditorRegistry` with `registerPanel`, `updateReadyState`, `resolveEditor`, and `disposePanel`. Store panel identity, URI, readiness, project generation, latest stamp, and a session-scoped request counter. Explicit IDs win; absent IDs resolve only a selected `TabInputCustom` with the Pindou view type, never `activeTextEditor` or the first open file. Sidebar Chat focus must not erase the selected custom-editor tab. Ambiguous/no targets return typed failures.
- [ ] Define `BlueprintToolRouter.invoke(operation, input, signal)` and `acceptResponse(panel, message)`. Each pending entry binds the originating panel, tool ID, generation, expected response type, cancellation, timeout, and result owner. Reject cross-panel replies, stale sessions, conflicting IDs, and duplicate completion; cap pending entries at 16. Serialize writes per editor; reads may run against the current stable state. Return `outcome_unknown` after an unacknowledged dispatched mutation, without automatic retry.
- [ ] Add a fake-panel unit test in `blueprintTools.test.ts` that sends a response from panel B for panel A's pending ID and asserts the promise remains pending until A replies. Add disposal, cancellation-before-dispatch, timeout-after-dispatch, and Chat-focus selection cases using fake timers and `vi.fn` panel methods.
- [ ] Run `npm --prefix platforms/vscode run test:unit -- src/blueprintTools.test.ts` for RED, then wire the registry/router into the provider. Include `editorId` with initial document delivery. After document load, the Webview emits `blueprintEditorReady` with its actual generation/revision; subsequent typed state updates maintain the host stamp. Install listeners before `signalReady` and remove them on unload. Call the production dispatcher directly, never the test globals.
- [ ] Register only `implementedToolNames` with `vscode.lm.registerTool`. Use names `pindouverse_<toolName>` and reference names `pindou_<toolName>`. `prepareInvocation` validates immutable input IDs and returns confirmation text for writes; `invoke` rechecks the same target IDs, trust, and cancellation. Never identify the target by comparing input-object references between callbacks. Convert the router result with this complete result adapter:

```ts
function toLanguageModelResult(result: ToolResult): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify(result)),
  ]);
}
```

- [ ] Export pure `toolDefinitions` from `toolContract.ts`: one descriptor per tool with `name`, `title`, `description`, `writes`, and schema. Descriptions state coordinates, target identity, null semantics, optional revision, and loss-confirmation behavior. The sync script generates `contributes.languageModelTools` from descriptors filtered to the implemented names. Each contribution contains `name`, `displayName`, `modelDescription`, `toolReferenceName`, `canBeReferencedInPrompt: true`, and `inputSchema`. Do not maintain handwritten JSON schemas in the manifest.
- [ ] Set host type-check `rootDir` to `../..` so imported shared contracts are within the source root; explicitly include the host tool modules and generator. Keep Webview/DOM implementation files excluded from the host entry set. The host and generator may import the pure contract, never `toolDispatcher.ts`, `editorStore.ts`, or `editorSession.ts` at runtime. A Node import smoke check of the generated host bundle must not need `window` or `localStorage`.
- [ ] Add `sync:tools` and `check:tools` scripts: bundle the TypeScript generator with esbuild into `dist/sync-agent-tools.cjs`, then execute it to update or compare the manifest. In `--check` mode it exits nonzero on drift and never writes. Use structured JSON parsing/writing and preserve unrelated manifest fields. Assert the initial contribution/runtime set is exactly inspect/search/set; later tasks extend that set only with working handlers.
- [ ] Add `requestBlueprintTool(page, operation, input)` to the existing test helpers. It obtains the actual initialized editor binding, posts a typed tool request, waits for a matching captured `blueprintToolResponse`, and returns `result`. It never invokes store methods on behalf of the tool. Use this real Webview test:

```ts
test("Agent editing preserves hand edits and supports one-step Undo", async ({ page }) => {
  await setupPage(page);
  await loadProject(page);
  await callAction(page, "newCanvas", [2, 1]);
  await callAction(page, "setCell", [0, 0, 7]);
  await callAction(page, "setCell", [0, 1, 8]);
  const historyBefore = await getStoreState<any[]>(page, "undoStack");
  const inspected = await requestBlueprintTool(page, "inspect_blueprint", {});
  expect(inspected.ok).toBe(true);
  if (!inspected.ok) throw new Error(inspected.error.message);
  const changed = await requestBlueprintTool(page, "set_beads", {
    editorId: inspected.stamp.editorId, projectGeneration: inspected.stamp.projectGeneration,
    expectedRevision: inspected.stamp.revision, layerId: inspected.stamp.activeLayerId,
    beads: [{ x: 1, y: 0, color: null }],
  });
  expect(changed.ok).toBe(true);
  expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(historyBefore.length + 1);
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  await callAction(page, "undo");
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
  await callAction(page, "redo");
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  expect(await getStoreState(page, "isDirty")).toBe(true);
});
```

Import `test`/`expect` from Playwright and the five used helpers from `./helpers`; install `cleanupHarness` through the existing suite cleanup convention. Add a rendered-canvas check for the changed cell after the next animation frame; a no-op must not count as the successful mutation probe.

- [ ] Build, run `agent-tools.spec.ts`, run host adapter/router units, and run `check:tools`. This is checkpoint A: the minimum real inspect/edit/Undo loop must pass before adding the remaining ten tools.

## Task 8: Add Shape, Fill, And Cross-Layer Replacement Tools

**Depends on:** Task 7.

**Files:** Modify `src/blueprint/toolDispatcher.ts`, extend `src/blueprint/toolDispatcher.test.ts`, `src/store/projectIntegrity.test.ts`, and `platforms/vscode/tests/agent-tools.spec.ts`. Reuse `src/utils/shapeDrawing.ts` and `src/utils/floodFill.ts` unchanged unless a proven extraction is required.

- [ ] Export pure `planShapeCells(shape)` from the dispatcher with this exact domain mapping; output remains row/column tuples until the final cell transaction:

```ts
import { lineCells, rectCells, circleCells } from "../utils/shapeDrawing";
import type { ToolInput } from "./toolContract";

export function planShapeCells(shape: ToolInput<"draw_shape">["shape"]): [number, number][] {
  switch (shape.kind) {
    case "line": return lineCells(shape.start.y, shape.start.x, shape.end.y, shape.end.x);
    case "rectangle": return rectCells(shape.region.y, shape.region.x,
      shape.region.y + shape.region.height - 1, shape.region.x + shape.region.width - 1, shape.filled);
    case "circle": return circleCells(shape.center.y, shape.center.x, shape.radius, shape.filled);
  }
}
```

- [ ] Write RED tests comparing shape cells to the existing helpers, including zero-radius circles, single-cell rectangles, filled/outline shapes, and right/bottom boundary rejection. Deduplicate generated shape coordinates before committing; caller-supplied duplicate bead coordinates still remain invalid.
- [ ] Implement rectangle fill with `rectCells(..., true)` and connected fill with `computeFloodReplaceEntries` on the named layer. Map every result to one `batchSetLayerCells` call. Validate the entire shape/region before allocation or commit; do not clip silently.
- [ ] Implement `replace_color` by collecting deltas for all selected layers and committing them once. For `allLayers`, if a hidden layer contains cells that would change, return `editor_busy` with those layer IDs and leave every layer unchanged; do not silently skip hidden matches or override visibility guards. Same source/destination code is a no-op.
- [ ] Add RED-to-GREEN tests for layered Undo/Redo, partial-invalid-batch rejection, connected versus rectangle semantics, and transparent color versus null. Run `npm test -- src/blueprint/toolDispatcher.test.ts src/store/projectIntegrity.test.ts` and the Webview tool spec.
- [ ] Extend `implementedToolNames` by draw_shape/fill_region/replace_color, regenerate declarations, and check parity. Checkpoint count: six registered tools.

## Task 9: Add Canvas, Layer, Grid, And Metadata Operations

**Depends on:** Tasks 3 and 8.

**Files:** Modify `src/blueprint/toolDispatcher.ts`; extend the existing dispatcher/store and Webview tool tests.

- [ ] For resize and nonempty-layer removal, first return the exact destructive preview shape without changing state:

```ts
const denied: ToolResult = {
  ok: false,
  error: {
    code: "data_loss_confirmation_required",
    message: "This change removes beads. Inspect the estimate and retry with its revision.",
    details: { lostBeads: 3, revision: 12 },
  },
};
```

The literals above define the response shape for a three-bead fixture at revision 12; production values come from the prospective operation. Count every layer, including hidden/occluded beads, not just the visible composite. A confirmed retry requires both `allowDataLoss: true` and the estimate's unchanged revision.

- [ ] Add parameterized RED tests covering all nine `manage_layer.change.kind` variants plus resize/grid/metadata. For each persistent operation capture project data/history, apply the tool, Undo, compare previous fields, Redo, and compare the committed fields. Activation preserves both stacks and dirty/revision values.
- [ ] Implement resize using the existing resize transformation and anchor interpretation, committing one reversible patch including old/new size, grid, and layers. Implement each layer variant using the shared Task 3 transaction boundary, with stable returned IDs and unchanged selection unless a deleted target requires deterministic cleanup. Keep the last-layer guard and existing merge-down precedence.
- [ ] Implement grid and metadata patch operations by assembling the complete prospective patch first. Apply one `commitProjectPatch`, not one setter per key. Null metadata values remove only those fields; reject invalid links and empty/unknown-key patches before mutation. No-op patches preserve redo history.
- [ ] Run dispatcher/store tests and Webview `agent-tools.spec.ts`, `layer-merge.spec.ts`, `layer-switcher.spec.ts`, and `layer-reorder.spec.ts`. Include a hand edit between loss preview and confirmation; expected `stale_revision` with zero mutations.
- [ ] Register resize_canvas/manage_layer/configure_grid/update_project_info only after GREEN, regenerate declarations, and verify ten implemented tools.

## Task 10: Add Invocation-Scoped File Authorization

**Depends on:** Task 7.

**Files:** Create `platforms/vscode/src/blueprintFileAccess.ts` and its unit test. Modify the host tool wiring and file handlers in `platforms/vscode/src/extension.ts`. Modify root dependency manifests only to add the image-header parser used below.

- [ ] Add RED tests for canonical root containment, including sibling-prefix paths:

```ts
import { expect, it } from "vitest";
import { isPathWithinRoot } from "./blueprintFileAccess";

it("does not mistake a sibling prefix for an authorized root", () => {
  expect(isPathWithinRoot("C:\\art", "C:\\art\\drawing.png", "win32")).toBe(true);
  expect(isPathWithinRoot("C:\\art", "C:\\art-private\\drawing.png", "win32")).toBe(false);
  expect(isPathWithinRoot("/art", "/art/../private/drawing.png", "posix")).toBe(false);
});
```

- [ ] Run `npm --prefix platforms/vscode run test:unit -- src/blueprintFileAccess.test.ts` for RED. Implement `isPathWithinRoot(root, candidate, flavor)` with `path[flavor].relative` and absolute-path checks, not `startsWith`. This function receives canonical paths; the asynchronous authorizer uses realpath on existing files and on the nearest existing parent for a new destination, and rechecks immediately before I/O.
- [ ] Implement `authorizeBlueprintFile` to mint an opaque host-only grant bound to editor session, tool invocation, exact canonical path, read/write purpose, and expiry. Workspace-root paths, the bound document, or a user-selected dialog path are allowed; an outside path requires an actual dialog grant. Reject unsupported schemes, symlink escapes, directories, extension/content mismatches, read-only destinations, untrusted workspaces, and a destination owned by another dirty editor. Dialog cancellation yields `cancelled` without writing.
- [ ] Add `agentFileGrantId` only to the invocation-scoped file-service requests generated by the trusted Webview bridge. Never accept it as model input, and do not use a global "current Agent operation" flag. The host verifies the grant on each I/O and revokes it on completion/disposal/cancellation. Untagged ordinary UI operations retain their current behavior; Agent handlers receive only the constrained service object, not the global unrestricted adapter.
- [ ] Install `npm install image-size@^2 --save-exact` at the root for header inspection before browser image decoding. Check both stat size and bytes actually read against 25 MiB; inspect decoded width/height with `image-size`, reject malformed data or more than 16,777,216 pixels, and permit PNG/JPEG/GIF/BMP/WebP only. Do not write ad hoc image-header parsers. Verify export allocation bounds before rendering and encoded output size before writing.
- [ ] Add temporary-directory tests for symlink escapes (platform-supported), cross-workspace authorization, expired/wrong-editor grants, overwrite denial, zero-byte and oversized images, and trust revoked between confirmation and I/O. No test prints file contents or credentials. Run the host file-policy and router unit files to GREEN.

## Task 11: Add Serializable Live Sessions And A Real Mutation Gate

**Depends on:** Tasks 3 and 7.

**Files:** Create `src/store/editorSession.ts` and extend `src/store/projectIntegrity.test.ts`. Modify `src/store/editorStore.ts`, `src/App.tsx`, and the VS Code Webview entry. Extend contract types in `src/blueprint/toolContract.ts` for session-control envelopes.

- [ ] Define these planned exports in `editorSession.ts`: `captureEditorSession()`, `restoreEditorSession(snapshot, destination, saved)`, `acquireEditorSessionLock(handoffId)`, and `releaseEditorSessionLock(handoffId)`. Capture returns an `EditorSessionSnapshot`; lock acquisition returns a typed busy/cancelled failure or success. Only the matching owner can release the lock.
- [ ] Define `EditorSessionSnapshot` with `version: 1`, full live `ProjectFile`, generation/revision, layer IDs, active layer, next default-name index, both history stacks, dirty state, saved baseline/status, clipboard, selection/bounds, view/tool settings, color overrides, reference image, and autosave preferences. Encode Map/Set values as typed arrays and exclude functions, DOM nodes, file handles, timers, pending promises, and GitHub authentication state. Preserve logical project ID and timestamps; the destination gets a new editor-session ID. Add a 64 MiB serialized session-transfer cap; failure retains the source.
- [ ] Add this codec/dirty-state regression in the existing initialized store suite, then run it RED:

```ts
it("restores live edits newer than the written snapshot", async () => {
  const store = storeModule.useEditorStore;
  const session = await import("./editorSession");
  store.getState().newCanvas(2, 1);
  store.getState().setCell(0, 0, 7);
  const written = storeModule.projectFromEditorState(store.getState());
  const savedRevision = store.getState().contentRevision;
  store.getState().setCell(0, 1, 8);
  const live = JSON.parse(JSON.stringify(session.captureEditorSession()));
  store.getState().newCanvas(1, 1);
  session.restoreEditorSession(live, { displayName: "/saved.pindou", writable: true },
    { project: written, savedRevision });
  expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
  expect(store.getState().isDirty).toBe(true);
  expect(store.getState().saveStatus?.revision).toBe(savedRevision);
  store.getState().undo();
  expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, null]);
});
```

- [ ] Restore via one internal state replacement with the transferred history, not `loadProjectDocument` followed by reconstruction. Validate every history layer/coordinate, palette index, dimension, and serializable field before changing state. If current revision differs from the disk snapshot revision, keep dirty state and the written snapshot as baseline. Detach external cloud credentials/association on destination binding consistently with existing local Save As policy.
- [ ] Introduce a store-level mutation gate owned by the session lock. All public mutation entry points, including drawing, Undo/Redo, view changes, project replacement, cloud completions, imports, and autosave scheduling, consult it before side effects. Authorized capture/restore/finalize internals use a private bypass, not public `setState` exposed to tools. Track and settle existing async work; do not merely place an overlay above the canvas.
- [ ] Set application `aria-busy` and disable ordinary editing controls during the brief handoff, preserving the existing visual design. An unfinished stroke/floating selection/adjustment prevents lock acquisition. Defer external document reloads; an external change invalidates transfer instead of overwriting captured state. Restore controls and autosave policy on timeout/abort.
- [ ] Add tests for every mutation source during a lock, wrong-owner release, codec corruption/size excess, duplicate layer IDs, missing history targets, and repeated acquire/release. Run `npm test -- src/store/projectIntegrity.test.ts src/store/cloudSync.test.ts` and extension drawing/undo/project-flow specs to GREEN.

## Task 12: Implement The Host Save Handoff State Machine

**Depends on:** Tasks 10-11.

**Files:** Create `platforms/vscode/src/saveHandoff.ts` and `platforms/vscode/src/saveHandoff.test.ts`. Extend shared session-control schemas in `src/blueprint/toolContract.ts`.

- [ ] Export `HandoffPhase`, `advanceHandoff(phase, event)`, and a `SaveHandoffCoordinator`. Use these valid transitions; an unmatched event returns the unchanged phase and cannot schedule side effects:

```ts
export type HandoffPhase = "prepare" | "write" | "capture" | "restore" | "commit" | "complete" | "aborted";
export type HandoffEvent = "destinationSelected" | "fileWritten" | "sourceCaptured" | "destinationReady" | "ownershipTransferred" | "abort";

export function advanceHandoff(phase: HandoffPhase, event: HandoffEvent): HandoffPhase {
  if (phase === "complete" || phase === "aborted") return phase;
  if (event === "abort") return "aborted";
  const transitions: Partial<Record<HandoffPhase, Partial<Record<HandoffEvent, HandoffPhase>>>> = {
    prepare: { destinationSelected: "write" }, write: { fileWritten: "capture" },
    capture: { sourceCaptured: "restore" }, restore: { destinationReady: "commit" },
    commit: { ownershipTransferred: "complete" },
  };
  return transitions[phase]?.[event] ?? phase;
}
```

- [ ] Write state-transition tests before adding the function, including abort in every nonterminal phase, late destinationReady after abort, and duplicate ownershipTransferred. Run `npm --prefix platforms/vscode run test:unit -- src/saveHandoff.test.ts` to observe RED then GREEN.
- [ ] Define `SaveHandoffCoordinator.run(intent, signal)` around injected dependencies: destination dialog/authorization, source snapshot capture, file write, source lock/live capture, staged destination creation, session restore acknowledgement, source save finalization, destination enablement, panel disposal, and lock/grant cleanup. `intent` contains source binding, optional expected revision, and the result owner (`agent` or `ui`). Keep file outcome and ownership phase in separate fields.
- [ ] Use control types `blueprintCaptureForSave`, `blueprintSaveSnapshot`, `blueprintAcquireSession`, `blueprintSessionCaptured`, `blueprintRestoreSession`, `blueprintSessionRestored`, `blueprintFinalizeSave`, `blueprintSaveFinalized`, `blueprintReleaseSession`, and `blueprintSessionReleased`. Each includes a string `handoffId` and bound editor ID/generation, never a numeric request ID or tool ID. Validate exact phase, direction, panel, and payload before advancing. Add an explicit host cancellation/abort message that cannot be mistaken for an acknowledgement.
- [ ] Implement the reviewed sequence exactly: select path, capture/write R, acquire source lock and capture latest L, restore L into disabled destination whose text document contains R, finalize the authoritative result, enable destination, retire source. A mismatched generation, new external reload, busy source, or failed destination acknowledgement aborts before ownership transfer.
- [ ] Preserve written-file evidence when capture/restore fails: `save_handoff_failed` details contain `fileWritten: true`, path, savedRevision, and surviving source ID. Do not unlink the file. Preserve source history/dirty state, dispose only the staged destination, release the matching source lock, and revoke grants. A write dispatched without conclusive acknowledgement yields `outcome_unknown`.
- [ ] Add dependency-call-log tests with controlled promises. Assert `disposeSource` never precedes `restoreAck`, a manual edit during write is in L, `completeResult` runs exactly once, and every abort phase releases locks without enabling a stale destination. Cover cancellation during a dispatched write separately from cancellation before write; never assert rollback of an uncertain write.
- [ ] Rerun handoff/file-policy/router unit tests. Checkpoint B: the coordinator's complete success/failure matrix passes before wiring real panel disposal.

## Task 13: Integrate First Save For Both Manual And Agent Flows

**Depends on:** Task 12.

**Files:** Modify `platforms/vscode/src/extension.ts`, `platforms/vscode/src/vscodeServices.ts`, `platforms/vscode/src/vscodeAdapter.ts`, `platforms/vscode/webview/main.tsx`, `src/platform/projectFileService.ts`, and `src/store/editorStore.ts`. Extend `platforms/vscode/src/saveDocument.test.ts`, `platforms/vscode/tests/helpers.ts`, and create `platforms/vscode/tests/agent-save-handoff.spec.ts`.

- [ ] Add this optional member to the existing `ProjectFileService` interface, preserving its other members:

```ts
export interface ProjectFileService {
  saveLiveProject?(mode: "save" | "saveAs"): Promise<PlatformResult<void>>;
}
```

Only the VS Code service implements it. At the start of store `saveProject`/`saveProjectAs`, route to this hook when present, before capturing the legacy snapshot or allocating the old formal-save cleanup ticket. Other platforms keep their current code path. This avoids returning to legacy source-store bookkeeping after the source panel has been transferred/disposed.

- [ ] In `vscodeServices.ts`, wrap the existing project service with a live-save service using `sendRequest("saveBlueprint", { mode, editorId, projectGeneration })`. Add `saveBlueprint: "saveBlueprintResult"` to the typed legacy reply map. Preserve non-save methods by explicitly delegating them; do not spread a class instance and lose its prototype methods. Agent `save_blueprint` calls the same host coordinator directly, using the Agent result owner instead of creating a nested source-owned tool promise.
- [ ] Add tests proving the live hook is used exactly once and the legacy `saveProject`/`saveProjectAs` methods are not called on VS Code. Test normal non-VS Code saves continue through the existing project-integrity suite. The hook must report disk errors/cancellation truthfully, not hide them as successful `void` results.
- [ ] Replace the host's existing `saveAs` write/open/dispose path with the coordinator. Manual and Agent entry paths collect the destination before snapshot R, and the destination's normal initial load cannot overwrite the staged live-session restore. Deprecate internal raw Save As requests once all callers migrate; reject any obsolete path that would bypass transfer rather than retain two disposal implementations.
- [ ] Reuse `saveDocument`/`SaveQueue` for in-place writes. Add a private source finalization action invoked through `blueprintFinalizeSave` to reconcile saved baseline/revision and settle the formal autosave-clear work before a handoff can dispose that source. Snapshot/export-only writes remain on their existing side-effect-free write path. Pause new autosaves and drain already queued writes during transfer; preserve the user's autosave preference in the destination.
- [ ] The coordinator owns completion. For Agent calls it resolves the host tool result once; source messages cannot resolve it. For manual live saves send/acknowledge the UI outcome while the source is still available, with destination readiness already confirmed. Do not release the old source to accept edits between acknowledgement and disposal. A failure before transfer leaves the old source usable; callbacks from an aborted destination cannot revive the transfer.
- [ ] Extend the Webview harness to create two independent pages/stores/message logs. The source writes R; while that write is deferred, use `callAction` for a manual edit to L; then acknowledge write, perform lock/capture, restore destination, and retire source. Assert disk payload is R, destination has L/history and dirty state, and Undo/Redo operates there. Do not emulate this through the old same-page Save As echo.
- [ ] Run root project-integrity tests, host save/coordinator units, and Webview `agent-save-handoff.spec.ts`, `file-ops.spec.ts`, `save-outcomes-i18n.spec.ts`, `autosave-silent.spec.ts`, and `project-flows-i18n.spec.ts` after build. Test cancellation/failure at every phase plus retained source identity. Register `save_blueprint` after GREEN; the count is now eleven.

## Task 14: Add Bounded Local Image Import And Blueprint Export

**Depends on:** Tasks 9-10 and 13.

**Files:** Create `src/blueprint/toolMedia.ts`; extend dispatcher/media tests using the existing store bootstrap, `platforms/vscode/tests/agent-tools.spec.ts`, and existing import/export tests. Modify `platforms/vscode/src/vscodeAdapter.ts`, `platforms/vscode/webview/main.tsx`, `src/utils/canvasExport.ts`, and `src/components/Export/ExportDialog.tsx` only for the shared helpers actually extracted.

- [ ] Define `ToolMediaServices` in `toolMedia.ts` with `importPixels(input, signal): Promise<PixelData>` and `exportImage(request, signal): Promise<void>`. Both are invocation-scoped closures supplied by the Webview bridge using host grants, not global mutable context. Add optional `mediaServices` as the fourth dispatcher argument; the initial synchronous tests remain valid without it. A missing required media service yields a typed unsupported-operation error via `invalid_arguments`, never a registered success stub.
- [ ] Write a deferred-import test: start import against revision R, make a manual edit before decoding resolves, then resolve valid pixels. Assert `stale_revision`, unchanged target cells/history, and no switch to another layer/project. Add cancellation and target-layer-disappearance variants. Run the store/media tests RED before implementation.
- [ ] Export `mapToolImportPixels(pixels, algorithm, overrides)` using `matchImageToMard(pixels.pixels, algorithm, "mard221", overrides)`, returning row/column/color-index cells for the requested dimensions. Reuse browser decoding and exact target resizing with Canvas; validate authorized bytes and image headers before decoding. Do not reuse the path-only `_cachedImagePath` cache for Agent imports: the same file path may now contain different bytes. Validate array length, final dimensions, placement, palette indices, and cancellation before committing one named-layer cell transaction. Never call the current `placeImageOnCanvas` project-replacement action.

```ts
import type { PixelData } from "../adapters";
import type { ColorMatchAlgorithm } from "../types";
import type { ColorOverrideMap } from "../utils/colorHelper";
import { matchImageToMard } from "../utils/colorMatching";

export function mapToolImportPixels(
  pixels: PixelData, algorithm: ColorMatchAlgorithm, overrides: ColorOverrideMap,
): Array<{ row: number; col: number; colorIndex: number }> {
  if (!Number.isInteger(pixels.width) || !Number.isInteger(pixels.height)
    || pixels.width < 1 || pixels.height < 1 || pixels.width > 256 || pixels.height > 256
    || pixels.pixels.length !== pixels.width * pixels.height * 3
    || pixels.pixels.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new RangeError("Invalid imported pixel buffer");
  }
  return matchImageToMard(pixels.pixels, algorithm, "mard221", overrides).map((colorIndex, offset) => ({
    row: Math.floor(offset / pixels.width), col: offset % pixels.width, colorIndex,
  }));
}
```

Unit-test malformed buffers with `expect(() => mapToolImportPixels({ width: 2, height: 1, pixels: [0, 0, 0] }, "euclidean", new Map())).toThrow(RangeError)`, and validate the successful coordinates for a two-pixel buffer. The media handler maps this validation exception to `invalid_arguments`; authorized file read/write failures remain `io_error`.
- [ ] Extract the export-dialog payload construction into a reusable pure helper `buildToolExportRequest(snapshot, settings, outputPath, labels)` in `toolMedia.ts`, using `getEffectiveColor`, `loadWatermarkSettings`, `composeHeaderDescription`, `resolveWatermarkAuthor`, and `computeWatermarkLines` from existing modules. Reuse `ExportImageRequest` and the current renderer. Capture labels, effective palette, project metadata, grid, watermark, and composite together before awaiting dialogs/rendering; export does not mutate metadata or dirty state.
- [ ] Add a shared layout-size calculation in `canvasExport.ts` if necessary so tool validation counts grid, padding, header, and legends before allocating the export canvas. Reject outputs above the pixel/byte limits instead of silently dropping sections. Snapshot size validation runs before building large payload arrays.
- [ ] Test real PNG and JPEG export signatures/dimensions from a tiny fixture with staged destination replies; preserve null cells and transparent-bead semantics, current labels/watermark defaults, and a hand edit after snapshot capture. A failing host write must produce `io_error` and must not report a saved/exported path as success.
- [ ] Build and run `agent-tools.spec.ts`, `import.spec.ts`, `export.spec.ts`, `export-adapters.integration.spec.ts`, and `transparent-bead.spec.ts`; run root dispatcher/store tests and extension type checks. Register import_image/export_blueprint after GREEN, regenerate declarations, and assert exactly thirteen tools in the schema, implementation, generated manifest, and runtime registry.

## Task 15: Complete Host, Browser, Compatibility, And Release Gates

**Depends on:** Tasks 1-14.

**Files:** Create `platforms/vscode/tests-e2e/suite/agent-tools.test.ts`. Modify `platforms/vscode/tests-e2e/runner.ts`, `.github/workflows/ci.yml`, `platforms/vscode/TESTING.md`, and `platforms/vscode/README.md`. Extend existing i18n resources/tests only for newly user-visible confirmation/error text; do not regress the shared English/Chinese UI.

- [ ] Add a deterministic host test using `vscode.lm.invokeTool` after opening a temporary `.pindou`. Include the actual active-editor identity returned by inspect and call the namespaced tools. Use this API shape, not a model request:

```ts
const inspected = await vscode.lm.invokeTool("pindouverse_inspect_blueprint", {
  input: {}, toolInvocationToken: undefined,
});
const text = inspected.content
  .filter(part => part instanceof vscode.LanguageModelTextPart)
  .map(part => part.value).join("");
const result = JSON.parse(text);
assert.equal(result.ok, true);
assert.equal(typeof result.stamp.editorId, "string");
```

Import `assert` from `node:assert/strict` and `vscode` from its host module; use the existing Mocha TDD `suite`/`test` style. Avoid mutation confirmations blocking unattended tests by injecting only the confirmation/dialog dependencies in `ExtensionMode.Test`; do not weaken production approvals.

- [ ] Add real first-save host tests with an injected destination dialog and controlled `openWith` dependency: successful staging/restore before source disposal, failed destination startup retaining the source, and exactly-once tool completion. Test injection is exposed only in `ExtensionMode.Test`, is not registered as an Agent tool, and grants no arbitrary store-action or filesystem endpoint. Use event acknowledgements/controlled promises instead of sleeps; set a test-specific lifecycle timeout above the coordinator timeout.
- [ ] Update the runner to pass `version: process.env.PINDOU_VSCODE_VERSION || "stable"` to `runTests`. Keep the Windows skip unchanged. Add a small Linux host matrix for `1.99.0` and `stable`, or run the existing host step twice with those values. Preserve the current root/browser-extension jobs and avoid running full Webview builds twice merely to test a second host version.
- [ ] Add `npm run check:tools` to CI after build. It checks all-13 manifest/schema/handler parity and generated schema drift. Test untrusted-workspace mutation rejection, protocol collision resistance, and absence of shared store initialization in the Node host bundle.
- [ ] Run final automated gates from the worktree root:

```powershell
npm test
npm --prefix platforms/vscode run check:types
npm --prefix platforms/vscode run check:tools
npm --prefix platforms/vscode run test:unit
npm --prefix platforms/vscode run test:webview
npm run ext:build:chrome
npm run ext:build:edge
npm run ext:validate
npm run ext:assert:no-ai
```

Shared history/session changes also require the existing browser-extension contract and E2E jobs to pass. Run locally when supported or use their required CI jobs; legacy desktop remains compile-only in its existing CI job. Do not update screenshots to conceal changed editor behavior.

- [ ] Run Linux host gates in the extension directory with `PINDOU_VSCODE_VERSION=1.99.0 xvfb-run -a npm run test:e2e`, then `PINDOU_VSCODE_VERSION=stable xvfb-run -a npm run test:e2e`. These are Linux shell commands, not PowerShell syntax. Record Windows host tests as skipped, never as passing.
- [ ] Separately verify actual Agent discovery on the declared minimum host and current Stable with compatible Copilot Chat installed, configured, and Agent mode enabled. Confirm all thirteen tools appear and can be selected, with correct reference names/descriptions and read/write approval behavior. The existing `--disable-extensions` automated host run cannot prove this gate; use an authenticated manual check or separate UI profile and record its host/Copilot versions and evidence in `TESTING.md`. No paid model call is necessary to inspect the picker. A policy-blocked or skipped discovery check blocks the compatibility claim.
- [ ] Document use through Agent tools, live unsaved-state behavior, explicit saves, IDs/revisions, destructive confirmation, file restrictions, unknown outcomes, and the distinction from future MCP support. Do not advertise an MCP server, CLI transport, or external-client support as shipped. Leave dependency/product release notes uncommitted until the user requests integration.

## Coverage And Checkpoints

| Requirement | Implementing tasks | Required evidence |
| --- | --- | --- |
| Layer-bound cell history and cross-layer Undo | 2, 3, 6, 8 | Manual A/tool B, layer switch, atomic multi-layer Undo/Redo, missing-target rejection. |
| Structural/configuration/metadata history | 3, 9 | Round-trips for resize and all persistent layer/grid/info operations. |
| Distinct RPC IDs, types, and reply validation | 4, 5, 7, 12 | Pending read/save/dialog survives wrong-direction, wrong-type, duplicate, and late replies. |
| Correct editor through Chat focus and confirmation | 4, 7, 15 | Immutable input IDs, selected custom tab, generation/disposal/cross-panel rejection. |
| Inspect/search/set minimum loop | 6, 7 | Checkpoint A: live hand edits retained, actual mutation, one Undo and Redo. |
| All thirteen tool operations | 4, 6, 8, 9, 13, 14 | Schema/handler/manifest/runtime set equality and per-tool Webview cases. |
| Destructive consent and stale revision | 4, 6, 9 | Loss count across layers; intervening edit invalidates confirmed retry. |
| Path/trust/media limits | 10, 14, 15 | Grants, canonical paths, trust recheck, predecode/header and export allocation limits. |
| Save As preserves R on disk and L in editor | 11, 12, 13, 15 | Checkpoint B state machine; two independent Webviews; real host panel lifecycle. |
| Manual saves share Agent coordination | 11, 13 | Live platform hook bypasses old source-owned bookkeeping; non-VS Code fallback preserved. |
| Cancellation and truthful outcomes | 5, 7, 10, 12, 13, 14 | Exactly-once completion, source unlock, fileWritten evidence, no blind retries. |
| Version, tool discovery, and non-AI browser boundary | 1, 7, 15 | Minimum/current host plus actual Agent picker, generated metadata check, existing browser CI. |

Checkpoint A gates tool-family expansion. Checkpoint B gates real Save As lifecycle integration. Final completion requires every row above plus the existing mandatory CI gates; a passing document or API check is not an application acceptance result.

## Plan Self-Review And Execution Handoff

- [ ] Before coding, confirm the root and extension dependency installs use this worktree and record baseline results.
- [ ] Verify every created/modified module belongs to a numbered task, every published tool has a real handler, and host-only imports cannot enter shared bundles.
- [ ] Verify task snippets and production types agree on `changesByLayer`, `toolRequestId`, `handoffId`, `editorId`, `projectGeneration`, `expectedRevision`, and `savedRevision`.
- [ ] After execution, record actual command outcomes and remaining manual compatibility evidence. Do not mark this checklist complete during planning.

Execution options: inline task-by-task execution using `executing-plans`, or explicitly selected subagent-driven execution with review between dependent tasks. No implementation, automatic commits, or new worktrees are performed merely by completing this plan.