# VS Code Blueprint Agent Tools

Date: 2026-09-17
Status: Revised after design review; awaiting approval of this written specification.
Scope: VS Code first; transport-independent operations for future MCP support.

## Decisions

- Expose high-level bead-art operations, not arbitrary JSON replacement or arbitrary store action invocation.
- Implement VS Code extension-contributed Language Model Tools first. These are Agent tools, not an MCP server.
- Include the complete editing scope approved by the user: bead editing, shapes, fills, colors, canvas dimensions, layers, grid settings, metadata, image import, image export, and project saving.
- Set the extension's minimum VS Code version to 1.99 (`engines.vscode: "^1.99.0"`), with API declarations from the same supported baseline. Version 1.95 has Language Model Tool APIs but does not provide the promised Stable Agent-mode integration; API availability alone is not the compatibility criterion.
- Keep the protocol and operation core independent of `vscode` so a later MCP adapter can reuse them.
- Do not automatically save edits, send prompts, or call a model whenever the user draws. The Agent invokes tools in response to a user request.
- This change does not add AI SDKs, API keys, model selection, or a chat interface to the editor.

## Baseline And Current Behavior

The implementation baseline is `origin/main` at `db34b04e70180cb84561262dfa560a13f983141f`.
Smooth wheel zoom is already present through `428b07b`; its tree matches the wheel-zoom PR branch tip `01dd418`.
The original workspace remains on its existing branch with its uncommitted files untouched.
Design work uses `.worktrees/vscode-agent-tools` on `feature/vscode-agent-tools`.

Relevant existing surfaces, relative to the repository root:

- `platforms/vscode/src/extension.ts`: custom editor registration, panel lifecycle, host messages, and explicit document saving.
- `platforms/vscode/src/saveDocument.ts` and `saveQueue.ts`: serialized saves and save-result acknowledgement.
- `platforms/vscode/src/vscodeAdapter.ts` and `vscodeServices.ts`: Webview-to-host file and service access.
- `src/store/editorStore.ts`: live canvas, layers, content revision, project generation, dirty state, and editor history.
- `src/App.tsx`: shared application workflows, including guarded project replacement.
- `platforms/vscode/tests/helpers.ts`: Playwright Webview harness with host-message capture, store actions, and staged file replies.

The live editing state is in the Webview's Zustand store. The underlying text document is not updated on every drawing action.
External text changes cause the host to send `loadDocument`, but this is a reload path, not a safe editing transaction.
The extension forwards Undo and Redo to the Webview. A `WorkspaceEdit` alone does not preserve the editor's history or unsaved drawing.
Consequently, Agent mutations must enter through live editor operations. Only explicit saving uses the existing document write path.

## Architecture

```text
VS Code Agent
  -> registered Language Model Tool
  -> extension request router
  -> targeted Webview request
  -> validated blueprint operation dispatcher
  -> editor state transaction
  -> immediate canvas update, dirty state, and editor history
  -> structured response to Agent

save_blueprint (existing bound document)
  -> existing project save service
  -> host save queue
  -> WorkspaceEdit and document.save()
  -> acknowledged save result

save_blueprint (first save / Save As)
  -> host-owned save coordinator
  -> write captured project snapshot without closing the source editor
  -> capture and transfer the latest live editor session
  -> destination restore acknowledgement
  -> finalize tool outcome and retire the source panel
```

### Operation Boundary

Define typed, JSON-serializable operation requests and results without VS Code dependencies.
The dispatcher uses existing store actions, geometry helpers, color matching, import conversion, export rendering, and project serialization wherever they satisfy the contract.
If an action is UI-only or lacks the required transaction semantics, extract the smallest reusable operation needed rather than simulating clicks or inventing a parallel implementation.
Register the bridge in the VS Code Webview entry or adapter lifecycle. Other platform bundles must not acquire VS Code tool registration or a network listener.
Do not expose the testing harness, `eval`, or a general-purpose `callAction` endpoint to the Agent.

### Editor Targeting

Maintain a registry of open Pindou editor panels, document identities, and readiness state.
Capture the intended editor before beginning an invocation or displaying confirmation; do not resolve the target again after an asynchronous step.
Moving focus from the editor to Chat must not lose the selected Pindou document. Track the selected editor tab separately from Webview keyboard focus.
An explicit returned editor identifier can address that same live editor on subsequent calls. Reject stale identifiers after disposal.
With no selected or explicitly identified Pindou editor, return `no_editor`; with an ambiguous target, return `ambiguous_editor`. Do not choose an arbitrary open file.
If the editor closes, is not ready, changes project, or is disposed while a request is pending, return a specific failure without redirecting the operation to another editor. The only planned panel replacement is the acknowledged Save As handoff below; it returns the destination editor's new identifier and never silently retargets other pending calls.

### Requests And Revisions

Host-to-Webview tool requests contain `type: "blueprintToolRequest"`, a string `toolRequestId`, `editorId`, the bound `projectGeneration`, `operation`, validated arguments, and optional `expectedRevision`. They never contain the legacy numeric `requestId` field.
The router binds each request to the panel and the current project generation. The dispatcher checks these identities before committing.
Successful reads return the editor identifier, project generation, content revision, dirty state, and requested data.
Successful writes return the new revision, an operation summary, and relevant counts or generated layer identifiers.

`expectedRevision` is optional for a direct current-state command. Agents should supply the revision returned by inspection for read-then-write operations.
When it is supplied, a mismatch returns `stale_revision` without mutation. When omitted, the operation applies to the live state at dispatch, not a previously read file snapshot.
Async operations such as image import always capture and recheck project generation and content revision before committing, even if the caller omitted `expectedRevision`.
Layer operations also verify their target layer still exists. Serialize tool mutations per editor and reject operations during an unfinished stroke, floating-selection edit, or modal adjustment with `editor_busy`.

### RPC Isolation

Use a discriminated message union and separate pending maps for the two directions of RPC:

- Existing Webview-to-host file/UI requests retain their numeric `requestId`. Each pending entry also records the expected response type; for example, `readFile` accepts only `fileResult` and `save` accepts only `saveResult`. Update the existing adapter receiver to check both type and ID before resolving anything.
- Host-to-Webview tool requests use `toolRequestId` values namespaced to the editor session, such as `tool:<session>:<counter>`. A `blueprintToolResponse` echoes that ID, `editorId`, and bound project generation, and carries a typed success/error result. `blueprintToolCancel` uses the same correlation fields but can never be accepted as a response.
- Save As session-transfer control messages use explicit request/acknowledgement types and a separate string `handoffId`; they do not borrow either RPC's ID field. The host accepts each acknowledgement only in the expected handoff phase from the bound source or destination panel.

Both sides validate direction, message type, originating panel/session, and correlation ID before consuming a pending entry. Messages with conflicting ID fields are rejected, and unknown, duplicate, late, or mismatched replies leave unrelated requests untouched.
Tool requests must be ignored by the legacy reply receiver, even while a save, read, or dialog request is pending. Different numeric suffixes or independent counters alone are not sufficient isolation.
Use the same production envelope validation in the Playwright harness; generic host replies must never stand in for tool responses or session-transfer acknowledgements.

## Tool Catalog

The catalog contains **13 tools**. Export and save are separate operations.
Public color arguments use actual codes from the current MARD palette, resolved by `search_palette`; never assume that array indices or a particular code prefix are stable.
Coordinates are zero-based: `x` is column, `y` is row. Rectangles use an inclusive origin plus positive `width` and `height`.
Layer identity uses stable IDs rather than localized names. Transparent beads remain real palette entries; `null` means no bead.

| Tool | Contract |
| --- | --- |
| `inspect_blueprint` | Read dimensions, project information, revision, dirty state, layer metadata, and bead/color counts. Optionally include a bounded rectangle of cells from a selected layer or the visible composite. Return color codes, not raw palette indices. |
| `search_palette` | Read-only lookup by code, name, or color value; return available codes and color metadata, with bounded results. |
| `set_beads` | Atomically set or clear a batch of coordinates on an explicit layer, or the active layer captured at invocation. Validate every item before applying any change. Reject duplicate coordinates rather than silently choosing an order. |
| `draw_shape` | Draw a line, rectangle, or circle with the editor's existing rasterization rules. Rectangles and circles support outline or fill. Validate the complete affected extent before mutation. |
| `fill_region` | Fill a rectangle or a connected region from a seed on the target layer. Connected fill uses the editor's existing connectivity and color-equality rules. |
| `replace_color` | Replace a source code with a destination code within the active layer, a specified layer, a rectangle on that layer, or all layers. The scope is explicit; never accidentally modify the flattened composite instead of layer data. |
| `resize_canvas` | Resize canvas bounds using an explicit anchor, without resampling existing beads. Count content that would be clipped across all layers; require `allowDataLoss: true` when the count is nonzero. |
| `manage_layer` | Add, rename, activate, show/hide, change opacity, reorder, duplicate, merge down, or remove a layer. Return affected/new IDs. Validate IDs, ordering, opacity, minimum layer constraints, and the legality of a merge. |
| `configure_grid` | Update group size, edge padding, coordinate origins, visibility, and line styles using existing editor constraints. This changes persisted settings, not bead positions. |
| `update_project_info` | Patch title, author, description, and link; omitted fields remain unchanged. Validate field types and existing limits. |
| `import_image` | Import a supported local image with explicit target dimensions, supported matching algorithm, placement, and target layer. Reuse current decoding and palette matching. Stage conversion before committing and reject stale results. |
| `export_blueprint` | Export PNG or JPEG through existing export/rendering services, preserving current blueprint settings and watermark defaults. Capture a consistent state snapshot. Report success only after output is written. |
| `save_blueprint` | Save through existing format serialization and the coordinated save lifecycle below. Existing projects use their bound path; unnamed projects request a destination through the normal dialog. Return the written revision, current dirty state, destination path, and current editor identifier. Distinguish a failed write from a successful write followed by a failed panel handoff. |

Inspection defaults to metadata and counts rather than returning an entire large canvas. Rectangle dimensions and response sizes are bounded.
Import and export use supported local file types only; arbitrary remote URLs, scripts, and binary payload execution are out of scope.
Saving and exporting must not silently overwrite another open dirty project. Use the existing Save As or overwrite-confirmation workflows where applicable.

## Transactions And History

- A content-changing tool call is one editor history entry, not one entry per bead. No-op calls do not add history or advance content revision.
- Validate all arguments and calculate the prospective result before committing. Do not mutate incrementally and attempt to recover through a series of public Undo calls.
- Batch failures leave canvas, layers, active layer, dirty state, revisions, and history unchanged.
- Extend the cell-history mechanism before exposing tools: each cell-delta transaction stores `changesByLayer`, a list of `{ layerId, entries }` groups. A single-layer edit has one group; all-layer color replacement has multiple groups in the same history entry. Undo and Redo use those stored IDs, never the current `activeLayerId`.
- Update every existing cell-history producer and consumer, including manual drawing, selection edits, stroke grouping, and Undo/Redo, to the layer-bound shape. This is an internal history change, not a `.pindou` format change. Stroke grouping keys include layer ID as well as coordinates. History belongs to the live project session, not to whichever layer has focus.
- Editing a non-active layer must not temporarily call `setActiveLayer`. Remove history clearing from ordinary layer activation so existing hand edits survive both UI and Agent layer switches. Changing the active layer remains non-persistent and adds no history entry.
- Structural/configuration/metadata transactions store reversible snapshots of the fields they change and occupy the same chronological history as cell edits. Undoing layer deletion restores the original layer IDs before older cell edits can be undone. If a required layer is unexpectedly missing, reject the entire history operation without changing state or popping history; never fall back to another layer.
- Canvas resize history must include the old dimensions and full affected layer state, not just a layer snapshot without dimensions.
- Persisted layer properties, grid settings, and project information must restore correctly on Undo and Redo. If existing actions do not support this, add focused shared history support and regression coverage.
- Activating a layer and performing reads do not dirty the project or create content history. Saving and exporting are not content mutations.
- Hidden-layer guards remain in effect. A tool must not silently make a layer visible or change an unrelated active layer to bypass them.
- Manual edits made before a tool call remain intact. Undo after a successful tool mutation reverses that operation while preserving prior hand edits.

## Save Lifecycle And Panel Handoff

Saving an already-bound document reuses the current save queue and document-save acknowledgement, retaining its Webview and history. Return `savedRevision` for the snapshot actually written, plus the current revision and dirty state; saving revision R must not mark a newer revision as saved.

First save and Save As require a host-owned coordinator. Do not directly reuse the current `saveAs` handler's write/open/dispose sequence: it can destroy the live state and the caller before the tool finishes. Reuse its file-writing primitives and dialogs, but replace the lifecycle with this sequence:

1. **Prepare.** Bind the source panel/session, project generation, and save operation. Select and validate the destination using the usual dialog and overwrite policy. Reject a destination already bound to a different Pindou editor rather than replacing that editor. Cancellation before writing leaves the source untouched. Source project replacement invalidates the operation.
2. **Write.** Capture project snapshot R after destination selection and validate the original invocation's revision precondition again. Serialize and write R while leaving the source panel alive. Manual editing may continue during this I/O; serialize other saves and tool mutations for this editor. Record the destination and `savedRevision: R` only after a positive write acknowledgement.
3. **Capture the live session.** After the write, request a brief source handoff lock. Acquire it atomically only when there is no unfinished stroke, floating edit, or adjustment; otherwise abort the handoff without closing the source. Under the lock, recheck project generation and capture the latest revision L, full live project data, active layer, undo/redo history, saved baseline, selection, and view state. This transfer is a typed internal session snapshot, not a disk-format reload. Manual edits made during step 2 are included even when L differs from R. Block all source mutations and defer external reloads while the lock is held; an external change aborts handoff rather than silently replacing the session.
4. **Restore.** Open the destination editor in a staging state and keep its editing/tool actions disabled until session restoration is acknowledged. Its text document represents R, but its Webview must restore L and the source history without using a normal `loadDocument` reset. Bind the new destination path, preserve the logical project identity and source content revision, and use R as the saved baseline/status. If L differs from R, preserve dirty state. The destination gets a new editor-session identifier; it must not reuse the source identifier. Validate the handoff ID, destination panel, and restored revision before proceeding.
5. **Commit the handoff.** With the restored destination ready and the source still locked, the host coordinator records and resolves the single authoritative tool outcome, including destination path, `savedRevision`, live revision, dirty state, and the new `editorId`. Enable the destination, invalidate source-targeted queued calls, then dispose the source. The source is not allowed to resume editing after successful ownership transfer. Pending tool completion must not depend on another callback from the soon-to-be-disposed source Webview.

Once the first-save workflow enters the coordinator, the coordinator owns completion of `save_blueprint`; duplicate source callbacks and intentional source disposal cannot complete or reject that invocation again.
Before ownership transfer, destination startup, restoration, acknowledgement, or lock acquisition failure leaves the source authoritative and editable with its complete live state/history. Tear down only the destination panel created for the failed handoff and release any source lock.
If the file was written but handoff failed or was cancelled, return `save_handoff_failed` with `fileWritten: true`, destination path, `savedRevision`, and the surviving source editor ID. Do not delete the written file, mark the unbound source as saved, or report that nothing was written. An uncertain write acknowledgement remains `outcome_unknown`, not a guaranteed failed write.
Host-side handoff timeouts and cancellation release a live source lock; source disposal aborts pre-transfer work, and a destination acknowledgement arriving after abort cannot revive it. Automatic saves must be paused during transfer so neither panel can initiate competing writes. After the ownership transfer commits, a late cancellation does not undo the save or switch ownership back.
Use this coordinator for the shared VS Code Save As path as well as the Agent tool so manual and tool-driven saves cannot take incompatible disposal paths.

## Destructive Operations And Confirmation

Use stable Language Model Tool registration and package contributions. Provide human-readable invocation summaries and VS Code confirmation requests for mutating tools, subject to the user's VS Code tool-approval policy.
Read-only tools do not request write confirmation. Export and save are file-writing tools even though they do not edit beads.

Shrinking a canvas or deleting a nonempty layer requires explicit `allowDataLoss: true` in addition to normal tool approval.
Without it, return `data_loss_confirmation_required` with loss counts and the current revision; do not partially apply the request.
Destructive retry requests must bind to the revision used for the loss estimate so an intervening user edit cannot invalidate consent.
Creating a layer returns its ID so a following mutation need not rely on whichever layer is active later.

## File Access And Security

Disable Agent-driven mutations and file access in untrusted workspaces while preserving existing ordinary editor behavior.
Host-side file services validate URI schemes, supported extensions, canonical paths, input/output size limits, and requested destinations before performing I/O.
Explicit local paths are limited to workspace roots, the bound project, or files selected through a user dialog. An out-of-scope path requires user selection; model-supplied text is not authorization.
Respect existing read-only-document handling and report denied writes without changing the dirty state incorrectly.
Metadata and image contents are untrusted data, never instructions or executable input.
Register only allowlisted operations; associate each response with its originating panel and request. Unsolicited, duplicate, or mismatched responses must not resolve a different invocation.

## Failure And Cancellation

Use structured result codes including `no_editor`, `ambiguous_editor`, `editor_not_ready`, `editor_closed`, `editor_busy`, `invalid_arguments`, `invalid_color`, `invalid_layer`, `stale_revision`, `data_loss_confirmation_required`, `cancelled`, `io_error`, `save_handoff_failed`, and `outcome_unknown`.
Include a short actionable message without embedding whole documents or binary contents.

The host maintains bounded pending requests and cleans them up on response, cancellation, timeout, or disposal.
Cancellation before commit leaves state unchanged. Once an atomic mutation has committed, a late cancellation does not undo it behind the user's back.
A lost acknowledgement or timeout after dispatch may leave the outcome unknown. Do not report a guaranteed rollback or automatically retry a potentially committed edit. Ask the Agent to inspect the current revision/state first.
Long-running image conversion must recheck cancellation and revision immediately before commit.
Save results follow the acknowledged in-place save or coordinated Save As path above. A failed or cancelled save preserves newer unsaved state; a concurrent edit during save must not be falsely marked saved. Save As results explicitly distinguish file-write success from editor-handoff success.

## Compatibility And Future MCP

The first stage ships no MCP transport, no local listening port, and no MCP discovery provider.
The supported baseline is VS Code 1.99 with a compatible Copilot Chat extension and Agent mode enabled. Stable Agent-mode availability and extension-tool discovery are separate requirements from the earlier `lm.registerTool` API. Organization policy can disable Agent features; report that prerequisite rather than claiming an API-only test proves the user experience.
Each `languageModelTools` contribution must include its input schema, model description, a unique `toolReferenceName`, and `canBeReferencedInPrompt: true`, in addition to runtime registration with `lm.registerTool`. Keep registration and contribution names consistent; all 13 tools must appear in the Agent tools picker when enabled.
Validate the declared minimum host and a current stable host, including a compatible Copilot installation for the discovery gate. Pin API declarations to the supported baseline for the minimum-version type check. If a required API or Agent discovery behavior is unavailable, raise the engine requirement and corresponding baseline tests together before publishing; do not silently retain 1.95 as a fallback.
The extension product version remains independent of the legacy desktop version system; this design-only change bumps neither.
Do not add new legacy desktop functionality or change other platform UI behavior as part of tool registration.

A future MCP adapter can map MCP tool calls onto this same validated protocol and result schema.
Live editing through an external client will require an authenticated local bridge into the extension. A file-only MCP server cannot safely replace live Webview operations when there are unsaved edits.
MCP transport, endpoint lifecycle, client authentication, discovery, and access outside VS Code require a separate design; they are not claimed as delivered here.

## Verification And Acceptance

### Unit Tests

Extend suitable store and host tests for code/coordinate/layer validation, atomic batches, shape/fill parity, palette null handling, history grouping, structural undo, revision conflicts, loss estimation, and targeted requests.
Use real operation logic with mocked platform I/O. Test rejection without mutations, not only successful tool results.
Test router request association, editor selection across Chat focus changes, disposal, timeouts, cancellation, and a mutation whose acknowledgement is lost.

Mandatory review regressions:

- Draw manually on layer A, tool-edit non-active layer B without activating it, switch layers through both UI and tool paths, and Undo/Redo. B alone reverts/reapplies and A's older hand-edit history remains usable.
- Replace colors across multiple layers with one history entry. Undo and Redo restore every affected layer atomically, independent of the active layer. Delete/restore a layer and then undo an older cell edit against its original ID; missing-target failure leaves the entire state/history unchanged.
- While file reads, saves, and dialogs are pending, deliver tool requests with equal counter suffixes, wrong response types, conflicting ID fields, duplicate replies, and late replies. Neither pending map may consume the other's messages; valid matching replies must still complete normally.
- Exercise every Save As phase with write failure, concurrent manual edits, busy source, destination-open/restore failure, acknowledgement timeout, cancellation, and source/destination disposal. Verify lock cleanup, exactly-once completion, truthful `fileWritten` reporting, and retention of the authoritative source when transfer has not committed.

### Webview Integration

Extend the existing Playwright harness to dispatch production tool requests and capture structured responses. Keep existing `callAction` and `stageReply` helpers for setup and file dialogs.
Do not let the harness's permissive generic replies fabricate successful tool execution.
Verify this sequence: hand edit, inspect current state, tool mutation, immediate canvas update, one Undo, one Redo, explicit save, and reload with equivalent content.
Cover each of the 13 tools, all `manage_layer` variants, failed batches, stale import completion, hidden layers, and cancelled/failed file operations.
Cover the layer-switch and RPC-isolation regressions through the real production dispatcher/adapter, not only mocked result objects. In particular, a colliding inbound tool request must not resolve a pending `readFile` or `save`.
Add a coordinated two-session Save As scenario: write R, hand-edit to L before transfer, restore the destination, then inspect and Undo/Redo. Assert the disk contains R, the destination retains L and its history, and dirty state remains set until L is explicitly saved. Keep source/destination lifecycles separate in the harness instead of treating Save As as an in-place `loadDocument` echo.

### Host And CI

Verify extension activation, contributions, tool schemas, dispatch, and result conversion with host-side tests.
Run a real VS Code read/write tool smoke test against an opened `.pindou`, including focus in Chat. Invoke registered tools deterministically without requiring a paid model call; this checks execution only, not Agent discovery.
Add a separate Agent-discovery release gate on the minimum supported host and current Stable with compatible Copilot Chat installed, configured, and Agent mode enabled. Verify all 13 tools are visible and selectable in the actual Agent tools picker, including reference names, descriptions, and read/write classification. This may be a recorded manual release check when authenticated UI automation is unavailable. No model request is needed to inspect discovery, but a skipped or policy-blocked check is not passing evidence and blocks the compatibility claim.
Host E2E must also cover a real first save creating a destination custom editor: verify the source is not disposed before restore acknowledgement, the tool completes once, and a handoff failure leaves the source usable. The single-Webview harness cannot prove real panel lifecycle behavior.
Run host E2E on Linux CI with xvfb; honor the repository's current Windows skip and do not report a skipped run as passing host coverage.
Run the complete extension unit and Webview suites and type checks before release; verify any touched shared-store behavior with its focused tests.

Acceptance requires all 13 tools to be discoverable and callable, live-state edits to refresh immediately without losing manual work, one-step reversible content mutations, truthful file results, and no silent application to stale or wrong editor targets.
The cheap first implementation probe is a production-shaped inspect/set request through the Webview harness, including an unsaved manual edit and Undo. If it cannot satisfy that contract, repair the operation boundary before expanding the tool catalog.

## Delivery Boundary

This artifact is a design specification only. No implementation, dependency installation, version bump, merge, commit, or publication is part of this step.
Review this written specification before producing the implementation plan.

## Review Resolution

- Layer-aware history is a prerequisite, including non-active-layer operations, cross-layer atomic Undo/Redo, and history preservation on ordinary layer activation.
- First save/Save As is a host-coordinated write-and-handoff transaction with explicit session migration, authoritative completion, and failure recovery.
- Bidirectional RPC has distinct ID fields, discriminated envelopes, typed reply validation, and collision regression gates.
- Compatibility targets VS Code 1.99 or newer and tests actual Agent discovery separately from tool API invocation.

## References

- VS Code Language Model Tools: https://code.visualstudio.com/api/extension-guides/ai/tools
- VS Code MCP developer guide: https://code.visualstudio.com/api/extension-guides/ai/mcp
- VS Code API reference: https://code.visualstudio.com/api/references/vscode-api
- VS Code 1.99 Stable Agent mode and extension tools: https://code.visualstudio.com/updates/v1_99#_vs-code-extension-tools-in-agent-mode