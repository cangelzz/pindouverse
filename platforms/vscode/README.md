# PindouVerse - Bead Art Editor for VS Code

> **PindouVerse for VS Code is the primary maintained platform and the recommended way to use PindouVerse.**

Open and edit `.pindou` bead art projects directly inside VS Code.

![PindouVerse Screenshot](icons/screenshot.png)

## Features

- **295-Color MARD Palette** — Full perler/fuse bead color set with search, filtering by group (solid, Morandi, pearlescent, special effects)
- **Multi-Layer System** — Independent bead layers with opacity, visibility, reorder, and duplicate
- **Grid Overlay** — Configurable 5x5 grouping with adjustable edge padding, line colors, and thickness
- **Blueprint Mode** — Color codes displayed in cells, mirror flip for viewing the back side
- **Project Management** — Save/load `.pindou` files, auto-save, version snapshots
- **Keyboard Shortcuts** — Ctrl+S save, Ctrl+O open, Ctrl+Z/Y undo/redo

## Usage

1. Open any `.pindou` file — it opens automatically in the PindouVerse editor
2. Use **PindouVerse: New Project** from the command palette to create a new project
3. Pick colors from the palette on the right, draw with the pen tool
4. Save with Ctrl+S

## Supported File Types

| Extension | Description |
|-----------|-------------|
| `.pindou` | PindouVerse bead art project file (JSON) |

## Requirements

VS Code **1.99.0 or newer** (`engines.vscode: ^1.99.0`). Host development uses the exact `@types/vscode` baseline **1.99.0**.

The editor works standalone. Agent usage additionally needs compatible, configured Copilot Chat with Agent mode enabled. Actual tool discovery on the minimum host and Stable is a separate [manual compatibility gate](./TESTING.md#manual-agent-discovery-gate); registration alone does not establish compatibility.

## Agent Tools

The extension implements thirteen native **VS Code Language Model Tools** through `vscode.lm.registerTool`. These are not an MCP server: external MCP clients, MCP transports, and a standalone CLI are not supported yet.

Registered names use `pindouverse_<operation>`; prompt reference names use `pindou_<operation>` (for example, `pindouverse_inspect_blueprint` and `#pindou_inspect_blueprint`).

| Operation | Behavior |
|---|---|
| `inspect_blueprint` | Read the live composite or a named layer, metadata, counts, and optionally a bounded region of cells |
| `search_palette` | Search actual MARD codes, names, or hex values in the selected editor |
| `set_beads` | Set or clear a batch of cells in one named layer |
| `draw_shape` | Draw a line, rectangle, or circle; reject out-of-bounds shapes |
| `fill_region` | Fill a rectangle or a connected region from a seed cell |
| `replace_color` | Replace a code in a layer/region or across all layers |
| `resize_canvas` | Change bounds without resampling, with `anchorRow`/`anchorCol` values 0, 1, or 2 |
| `manage_layer` | Add, rename, activate, show/hide, change opacity, reorder, duplicate, merge down, or remove layers |
| `configure_grid` | Patch persisted grid settings without moving beads |
| `update_project_info` | Patch title, author, description, or an HTTP(S) link; omitted fields remain unchanged and `null` clears a field |
| `import_image` | Convert a local image into beads in a named layer at a requested position and size |
| `export_blueprint` | Write a live snapshot as PNG or JPEG; this does not save the project |
| `save_blueprint` | Explicitly save the live project to its current path or use the first-save dialog |

### Live Editing And Identity

1. Open/select a Pindou editor and inspect it. Reads may omit `editorId` to use the selected Pindou custom-editor tab, including while Chat has focus. They do not open a project from a supplied path.
2. Take `editorId`, `projectGeneration`, `revision`, and `activeLayerId` from the returned `stamp`. All non-read tools require explicit `editorId` and `projectGeneration`; layer edits also require `layerId`. Pass `revision` as `expectedRevision` to reject intervening edits. This revision guard is optional except for confirmed data loss.
3. Search the palette and use returned codes, never array indices or invented codes. Cell coordinates are zero-based: `x` is column, `y` is row. Displayed grid labels do not change these coordinates. `null` clears a bead where accepted; it is not a transparent color. Duplicate batch coordinates are rejected.
4. Edit the live, possibly unsaved state, then inspect the result. Use the newest stamp for the next operation; a replaced project or closed editor invalidates old identities. Successful content changes share the editor's Undo/Redo history: one operation is one undo step, including a multi-layer replacement. No-ops and layer activation add no persistent edit; reads, export, and save are not undoable content edits.
5. Save explicitly with `save_blueprint` or the normal editor Save command. Editing tools do not implicitly save the project. Existing auto-save/recovery settings remain separate, and exporting an image does not clear project dirty state.

Writes can return `editor_busy` during a stroke, floating selection, color adjustment, or session handoff. Cell edits require visible target layers. Color replacement rejects matching beads on hidden layers instead of silently skipping or editing them; merge-down requires both layers visible.

### Destructive Operations

Shrinking bounds or removing a nonempty layer can return `data_loss_confirmation_required` with `lostBeads` and `revision`. Review that estimate before retrying with `allowDataLoss: true` (inside `change` for layer removal) and the estimate's revision as `expectedRevision`. An intervening edit makes that confirmation stale. The last layer cannot be removed. These checks are separate from the write confirmation requested through VS Code's tool API.

### Files And Limits

- All non-read tools, including import, export, and save, require a trusted workspace. Production tools request write confirmation; read tools do not request mutation confirmation.
- Explicit import paths must be absolute local regular files within a canonical workspace root. Outside-workspace files require user selection through a file dialog. Remote URLs, relative paths, UNC paths, and Windows alternate data streams are rejected. File grants are bound to the editor/operation, expire, and are rechecked before access.
- Import accepts PNG, JPG/JPEG, GIF, BMP, and WebP, up to 25 MiB and 16,777,216 decoded pixels. Omit `path` to choose a file. Conversion must fit the canvas and is rejected if project content changes before it commits.
- Export **always opens a save dialog** in the current implementation, even with `path`; that value is only the suggested destination. PNG/JPEG output is limited to 16,777,216 pixels and 64 MiB, with `cellSize` from 8 to 64. Reduce `cellSize` when the decorated export exceeds the limit.
- Webview editing/export tools reject canvases above 256 cells on either axis. A bead batch allows at most 65,536 cells; inspection returns at most 4,096 requested cells and a 64 KiB response. Inspect larger designs in smaller regions. Requests have an 8 MiB limit; first-save session transfers have a 64 MiB limit.

### First Save And Uncertain Outcomes

First save writes snapshot revision **R** to disk, then captures and restores the live session at revision **L** in the destination editor, including Undo/Redo, selection, clipboard, and view state. If edits occurred during the write, `L > R`: the destination keeps those edits and stays dirty, while the disk and saved baseline remain at R. The result reports `savedRevision`, `fileWritten`, and the destination stamp; use its new `editorId` afterward. A later explicit save is needed to persist newer edits. Local destination binding detaches the cloud association.

An error is not proof that nothing changed. `save_handoff_failed` can mean the file was already written but editor migration failed; inspect `path`, `fileWritten`, `savedRevision`, and `cleanupFailed` when returned, and check the retained source editor. A dispatched write that times out, is cancelled, or loses its acknowledgement can return `outcome_unknown`; editor closure can also leave a write unconfirmed. **Do not blindly retry.** Inspect the relevant live editor and verify any output file before deciding whether another operation is needed.

## About PindouVerse

PindouVerse (拼豆宇宙) is a perler bead pixel art editor. The VS Code extension is the primary maintained platform. Chrome and Edge browser extensions are secondary maintained platforms, while iOS and Android remain work in progress.

The Desktop / Tauri client is **Legacy / Deprecated**: it no longer receives routine feature development or releases. Its source remains in the repository, and historical Desktop releases remain available from [GitHub Releases](https://github.com/cangelzz/pindouverse/releases) for existing users.

- [GitHub Repository](https://github.com/cangelzz/pindouverse)
- [Report Issues](https://github.com/cangelzz/pindouverse/issues)

## License

Non-commercial use only — source code is licensed under the
[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
license, with an explicit carve-out: selling physical bead artwork you
produced using this software is NOT considered Commercial Use.

Sample bead-art designs in `samples/` are separately licensed under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

Releases through 0.8.9 inclusive remain available under MIT (irrevocable
for those versions). 0.8.10 onward is non-commercial.

For commercial licensing, open a GitHub issue with the label
`commercial-license`.

## Development

See [TESTING.md](./TESTING.md) for contribution checks, unit tests, Playwright webview tests, real-host tests, and the separate manual Agent discovery gate.
