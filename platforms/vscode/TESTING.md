# Testing the VS Code Extension

Run extension commands from `platforms/vscode/`. Automated coverage includes contract/adapter units, a mocked-host webview, and real VS Code hosts. Actual Copilot Agent discovery is a separate manual gate.

## Quick reference

| Command | What it does | When to run |
|---|---|---|
| `npm run check:types` | Type-check host and webview; host API baseline is exactly `@types/vscode` 1.99.0 | Before integration |
| `npm run check:tools` | Compare generated tool contributions with the manifest; check mode does not write the manifest | After build and whenever tool contracts change |
| `npm run test:unit` | Adapter, routing, file-access, and save-handoff unit tests | Whenever host/adapter contracts change |
| `npm run test:webview` | Playwright tests against the webview bundle (several minutes, headless Chromium with mocked extension host) | Before every publish; whenever you change webview/store code |
| `npm run test:e2e` | Build, compile host tests, and run `@vscode/test-electron`; host selected by `PINDOU_VSCODE_VERSION` (default `stable`) | Linux/macOS; Windows skips automatically and leaves host behavior unverified |
| `npm test` | Unit, webview, and host suites (subject to the Windows host skip) | Full extension check; does not include `check:tools` or manual discovery |

Only `test:webview` and `test:e2e` automatically build the extension. `check:tools` bundles its checker into `dist/` but only reads the manifest. It checks generated metadata/schema drift, not runtime handler coverage or actual picker discovery; those need tests and the manual gate below.

## Layer A — Webview tests (Playwright)

Files in `tests/`:

| File | Coverage |
|---|---|
| `webview.integration.test.ts` | Critical-path smoke (load file, render pixels, save, projectInfo title) |
| `file-ops.spec.ts` | New / Open / Save / Save As / Auto-save / dirty tracking. Includes regression coverage for the 0.8.4 (image import), 0.8.5 (Save As), and 0.8.6 (untitled overwrite) bugs |
| `drawing.spec.ts` | `setCell`, `batchSetCells`, eraser, `setTool`, `replaceColor`, toolbar button wiring |
| `edit-ops.spec.ts` | Undo / Redo (including Ctrl+Z), selection, clipboard, paste, deleteSelection |
| `import.spec.ts` | Image import dialog: file picker → preview → auto-detect → 预览 → 对比 → 确认导入 |
| `export.spec.ts` | Blueprint PNG, preview JPG, mirror export, cancel-dialog handling |
| `agent-tools.spec.ts` | Live Agent tool dispatch and reversible editor operations |
| `agent-save-handoff.spec.ts` | First-save session transfer between independent mocked-host webviews |

### How it works

The harness (`tests/helpers.ts → createTestHtml`) loads the built webview bundle and stubs `acquireVsCodeApi`. Every postMessage from the webview is captured, and any request with a `requestId` is auto-replied (`showSaveDialog`, `showOpenDialog`, `readFile`, `writeFile`, `saveAs`, `getAutosaveDir`). Use `stageReply()` to queue specific responses before triggering an action.

### Helper API

```ts
import {
  setupPage,        // boot the harness HTML (call once per test)
  loadProject,      // simulate the host opening a .pindou file
  cleanupHarness,   // afterAll cleanup
  callAction,       // dispatch a Zustand store action: callAction(page, 'setCell', [0, 0, 5])
  setStoreState,    // setState shortcut
  getStoreState,    // read a single store field
  stageReply,       // queue a fake host response: stageReply(page, 'showSaveDialog', '/foo.pindou')
  getMessages,      // all postMessage payloads sent by the webview
  getWrites,        // captured writeFile / save / saveAs payloads
  clearMessages,
  clickButton,      // page.getByRole('button', { name }).click()
  countRenderedPixels,
} from "./helpers";
```

### Adding a new test

```ts
import { test, expect } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState, stageReply } from "./helpers";

test.describe("My new feature", () => {
  test.afterAll(() => cleanupHarness());

  test("does the thing", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);              // loads samples/asuka71x100.pindou
    await stageReply(page, "showSaveDialog", "/picked/file.pindou");
    await callAction(page, "saveProjectAs");
    expect(await getStoreState(page, "projectPath")).toBe("/picked/file.pindou");
  });
});
```

### Conventions

- **Prefer store actions** (`callAction(page, 'setCell', [r, c, color])`) over synthetic canvas pointer events. The canvas mouse handler ultimately calls the same store actions, and pointer events are flaky across zoom/offset/DPI.
- **Always stage replies before triggering actions** that go through the adapter. Otherwise the request hangs and the test times out.
- **Use Chinese button labels with regex** when possible: `page.getByRole('button', { name: /^预览$/ })` because the dialog has multiple buttons containing "预览".

## Layer B — Host smoke tests (`@vscode/test-electron`)

Files in `tests-e2e/`:

| File | Purpose |
|---|---|
| `runner.ts` | Downloads VS Code and launches it with the extension under development |
| `suite/index.ts` | Mocha entry point |
| `suite/extension.test.ts` | The actual tests |
| `suite/agent-tools.test.ts` | Thirteen-tool registration, inspect/search/edit/save via `vscode.lm.invokeTool`, destination restoration, and retained source after a post-write destination failure |
| `fixtures/sample.pindou` | Test project |

These verify behavior that **only happens in real VS Code**: command registration, custom editor view-type binding, `vscode.openWith` after Save As switching the active editor.

The runner uses `--disable-extensions` and the tool tests bypass production confirmation in `ExtensionMode.Test`. `vscode.lm.tools` and `vscode.lm.invokeTool` test registration/API execution, not Copilot Chat's Agent picker, tool selection, or production approval UI. Do not use these results as Agent discovery evidence.

### Windows local skip

`Code.exe` on modern VS Code releases is a thin launcher that rejects the CLI flags `@vscode/test-electron` passes (e.g. `--extensionTestsPath=...`). The test runner detects Windows and prints:

```
[e2e] Skipping on Windows (set PINDOU_FORCE_E2E=1 to run anyway).
```

Set `PINDOU_FORCE_E2E=1` to attempt anyway. A skipped run may exit successfully, but must be recorded as **SKIPPED / host unverified**, never as a passing host test. Mocked webview tests do not replace this evidence. CI runs the real-host gate on Linux with `xvfb-run`.

## CI

The [CI workflow](../../.github/workflows/ci.yml) `test-vscode` job runs on every PR and push to main. It builds once, runs `check:tools`, units, and Playwright against the existing bundle, then compiles host tests once and invokes the runner twice. It uses minimum host **1.99.0** and current **Stable**, preserving the root, browser-extension, and Legacy Desktop compile jobs and existing permissions.

Equivalent Linux commands after dependencies and Playwright Chromium are installed (not PowerShell syntax):

```bash
npm run build
npm run check:tools
npm run test:unit
npx playwright test
npx tsc -p tests-e2e/tsconfig.json
PINDOU_VSCODE_VERSION=1.99.0 xvfb-run -a node out-e2e/runner.js
PINDOU_VSCODE_VERSION=stable xvfb-run -a node out-e2e/runner.js
```

On failure, `test-results/` is uploaded as an artifact. Retain host runner logs too, including the exact version resolved from `stable`; a configured CI step is not evidence that it has passed.

## Manual Agent Discovery Gate

Use separate user profiles for VS Code 1.99.0 and current Stable, with this extension and a **compatible Copilot Chat version** installed, authenticated/configured, and Agent mode enabled. Do not use the automated host's `--disable-extensions` launch. If a compatible Chat version, policy permission, or Agent mode is unavailable, record the block; do not claim minimum-host compatibility.

1. Open a disposable `.pindou` project in a trusted workspace, switch to Chat, and open Agent mode's tool picker. Confirm all thirteen [Agent tools](./README.md#agent-tools) appear and can be selected, with `pindouverse_<operation>` registrations, `pindou_<operation>` references, and matching descriptions. Record screenshots and versions. Inspecting the picker does not require a paid model call.
2. Separately exercise the normal Agent invocation/approval flow on that disposable project. Confirm reads do not request mutation confirmation, writes request approval, and declined writes leave the design unchanged. Record actual outcomes; test-mode confirmation bypass is not evidence. Recheck mutation rejection in an untrusted workspace.
3. Verify inspect/search/edit uses the selected editor despite Chat focus, retains existing unsaved hand edits, and gives one Undo/Redo step. Check stale-revision and loss-confirmation rejection. Verify explicit save, first-save R-on-disk/L-live behavior, and handling of uncertain file outcomes before retrying.
4. Record the tested commit/build, OS, exact host and Chat versions, date, tester, evidence links, and any blocked/skipped checks in the table below. Discovery and approval results must be recorded independently of automated host results.

## Release Evidence

Local evidence below is for the uncommitted `feature/vscode-agent-tools` worktree based on `db34b04`, checked on Windows on 2026-09-17 by GitHub Copilot and its validation workers. It is not a release sign-off or a result from remote CI. **NOT RUN** means no result is recorded here; replace it only with actual evidence. Any skipped or blocked manual discovery check blocks the Agent compatibility claim.

| Gate | Host / Chat baseline | Status | Evidence / date / tester |
|---|---|---|---|
| User-reported functional smoke test | User's local VS Code; exact host/Chat versions not supplied | PASS (user reported) | 2026-09-21: user reported "已经实际测试，功能正常" following delivery of the 1.5.0 VSIX. Individual tools, approval/cancellation cases, and exact installed build were not enumerated. |
| Build and exact API type check | `@types/vscode` 1.99.0 | PASS locally | 2026-09-17: extension build and separate host/webview type checks passed. |
| Generated contributions match thirteen implemented tools | Manifest/contract | PASS locally | 2026-09-17: `sync:tools` regenerated 13 entries; `check:tools` passed. |
| Root and extension unit tests | Node | PASS locally | 2026-09-17: root 787 tests across 78 files; extension 41 tests across 7 files. |
| Webview and two-webview save transfer | Mocked host / Chromium | PASS locally | 2026-09-17: full `test:webview` passed 214/214 in 3.0 minutes after fixing the export mock reply type. |
| Windows real-host run | Local Windows | SKIPPED / host unverified | 2026-09-17: host-test TypeScript compilation passed; the runner reported its intentional Windows skip. |
| Automated real-host tools and save lifecycle | VS Code 1.99.0 / Chat disabled | NOT RUN | Pending Linux runner logs |
| Automated real-host tools and save lifecycle | Stable (record resolved version) / Chat disabled | NOT RUN | Pending Linux runner logs |
| Manual Agent picker discovery and selection | VS Code 1.99.0 / compatible Chat version TBD | NOT RUN | Pending profile details and screenshots |
| Manual production approval and live-edit/save flow | VS Code 1.99.0 / compatible Chat version TBD | NOT RUN | Pending |
| Manual Agent picker discovery and selection | Stable / compatible Chat version TBD | NOT RUN | Pending profile details and screenshots |
| Manual production approval and live-edit/save flow | Stable / compatible Chat version TBD | NOT RUN | Pending |
| Browser-extension build, validation, and no-AI checks | Local Windows | PASS locally | 2026-09-17: Chrome and Edge builds, manifest/type validation, and no-AI checks passed. |
| Browser-extension contract/E2E | Local Windows / Chromium | PASS locally | 2026-09-17: contract 1/1; full browser-extension E2E 36/36 including contract. |
| Required remote CI and Legacy Desktop compile jobs | Existing CI environments | NOT RUN | No branch push or remote CI run was performed. |

For local Windows runs that print the skip message, enter **SKIPPED / host unverified**, not PASS. The user-reported smoke test confirms their tested functionality, not the full version-specific Agent picker/approval matrix. Minimum-host compatibility, unenumerated edge cases, automated Linux hosts, and remote CI remain unverified until their own evidence is recorded.

## Pre-publish checklist

Before an explicitly approved publish:

1. Run `npm run build`, `npm run check:tools`, and `npm run test:unit`; run root `npm test` for shared contracts/history changes.
2. Run `npm run test:webview` locally before every publish, and obtain passing real-host results for both 1.99.0 and Stable. CI's single-build equivalent above avoids redundant builds.
3. Complete the manual discovery and production approval gates for both hosts, recording actual versions and evidence. Leave compatibility unverified when a gate cannot run.
4. Require the existing browser-extension contract/E2E and other CI jobs for shared history/session changes. Do not replace failing evidence by updating screenshots.
5. Only when release/integration is separately authorized, follow the extension's independent version/changelog process and approved publish workflow. Validation alone does not authorize a version bump, commit, or publish.
