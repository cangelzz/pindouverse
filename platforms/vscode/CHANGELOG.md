# Changelog

## 0.8.1

- History dialog: show from→to color swatches and position for single-pixel changes; verbose tooltip for batch actions
- Preview thumbnail: defaults to right side (no longer blocks left axis labels), position persists across reloads, default size enlarged to 400px, clearer drag handle
- Preview thumbnail: stop event propagation so dragging/clicking the preview no longer pans or draws on the canvas underneath
- Blueprint mode: coordinate labels now rendered on all four edges (top/bottom for columns, left/right for rows)

## 0.8.0

- Cross-window copy/paste via system clipboard
- Draggable floating selection with marching ants border
- Grab/grabbing cursor on selection hover/drag
- Changes preview: overlay highlight for added/removed/modified cells
- Side-by-side compare dialog with synced zoom/pan and resizable window
- Auto-collapse sidebar when window is narrow (e.g. diff view)
- Default tool set to pan (hand) instead of pen
- Feedback button with pre-filled system info (version, platform, canvas)
- Clear selection state on new canvas and open project

## 0.7.0

- Fix save opening dialog instead of saving to current file
- Fix canvas clearing after save (save-echo suppression)
- Fix projectInfo and projectPath not loaded from document
- Prevent Vite dev server page reload on .pindou file save
- Harden canvas resize with size-change guard
- Add integration tests for critical paths (load, save, render)
- Add test-vscode CI job

## 0.6.1

- Fix canvas not auto-resizing when sidebar collapses/expands

## 0.6.0

- Collapsible sidebar with inline toggle button
- Blueprint export now works in VS Code (canvas-based rendering)
- Color override system for user calibration (right-click palette colors)
- Adjusted colors group in palette dropdown
- Width compensation slider for image import
- Adjustable/movable crop selection in image import

## 0.5.0

- Project info dialog (title, author, description, link)
- Window title shows project name and path
- Cloud sync: optimistic UI for upload/delete (GitHub API consistency fix)
- Success messages after cloud operations

## 0.4.0

- Arrow key navigation in blueprint mode
- Exit fix for unsaved changes
- Selection drag preview

## 0.3.0

- GitHub cloud sync via Gist (upload, download, delete, version history)
- VS Code native GitHub authentication (account picker)
- Sync status indicator (☁️✓ synced / ☁️● local changes)
- Conflict detection with side-by-side compare preview
- Selection tools (rectangle select, magic wand)
- Cut/Copy/Paste/Delete selection (Ctrl+C/X/V, Delete)
- Canvas resize with anchor selector
- History dialog for undo/redo navigation
- Undo stroke batching (one stroke = one undo step)
- Mac keyboard support (Cmd+Z/Shift+Z)
- Auto-fit canvas to window on load
- Exit protection for unsaved changes
- New Project opens blank canvas without save dialog
- Open Project command for existing .pindou files

## 0.2.0

- Add canvas resize feature ("调整画布") with anchor selector and crop warning
- Fix .pindou files opening empty (missing Tailwind CSS in webview build)

## 0.1.0

- Initial release
- Custom editor for `.pindou` files
- Full 295-color MARD palette with search and filtering
- Multi-layer support with opacity and visibility
- Grid overlay with configurable grouping
- Blueprint mode with color codes
- Project save/load, auto-save, version snapshots
- New Project command
