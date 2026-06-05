# Changelog

## 1.0.4

- Feature: 图层面板的激活行加粗背景 + 左侧色 bar,选中的图层一眼能看出。每个图层(包括未选中的)都显示左色 bar,激活的更宽更深。色板用深一档莫兰迪 — blue / green / terracotta / violet / coral / teal / amber / plum,饱和度足够在小尺寸下也分得清;默认层用 warm stone。
- Feature: 当选中非默认图层时,画布上鼠标**右上方**(+24, -24)出现浮动小标签(白底圆角 + 小色块 + 图层名),跟随鼠标移动,鼠标离开画布消失 — 帮你避免在错误的图层上画半天才发现。`pointer-events: none` 不抢交互。
- Feature: 图层面板顶部新增「画布上显示浮动图层提示」开关(只在图层数 ≥ 2 时显示),默认勾选;不需要这个提示的时候关掉即可。
- 新增 `src/utils/layerColors.ts` 提供 `layerAccentColor(idx)`(idx=0 → 默认色;idx ≥ 1 → palette 取模循环)。6 个单测 + 5 个集成测试。

## 1.0.3

- Fix: 矩形选区周围的 8 个 resize handle 现在真的能拖了。以前 `renderResizeHandles` 只把小方块画在 canvas 上,`handleMouseDown` 根本没做命中检测 — 点 handle 要么清掉选区要么开始新框选,从来没 resize 过。新加 `src/utils/selectionResize.ts` 提供纯函数 `hitTestResizeHandle` / `computeResizedBounds` / `cellsFromBounds` / `isRectangularSelection`,PixelCanvas 在 mousedown 时优先做 handle 命中,命中后挂 window 级 mousemove/mouseup(画布级 onMouseLeave 会清状态,挂在 window 让 drag 过画布边界仍能跟踪),mousemove 重算 bounds + `setSelection`,mouseup 解绑。拖出画布时坐标 clamp 到 canvas 内 (1.0.2 behavior choice: clamp not extend)。不规则选区(魔棒、shift-add 等)不显示 handle,避免误操作把不规则形状压成矩形。

## 1.0.2

- Fix: 导出图纸 PNG 现在与桌面端输出对齐,且布局/视觉做了几处针对 VS Code 的增强:
  - 之前所有空格子没有网格线 —— 单元格描边在 `if (!cell) continue` 内,空格子直接跳过。改为画桌面端那套三层全画布网格线(细 1px 每格 + 中 2px 每 5 格 + 粗 3px 每 10 格 + 外框),空格子也有边线。
  - 之前坐标编号(行/列序号)看不见 —— 画布尺寸没留 axis label 的边距,在 `edge_padding=0`(默认值)时坐标被画到 `y = -labelSize`,直接被裁掉。
  - 现在画布上下左右各预留一个 cellSize 的空白条:上下放列号,左右放行号。比桌面端的"只上+左"更易读。
  - 之前导出 PNG 顶部没有应用图标 —— vite 把 64x64 图标当外部 asset(`/assets/64x64.png`)发布,在 webview 里这个绝对路径解析到 `vscode-cdn.net` 根目录直接 404。提高 vite `assetsInlineLimit` 到 8KB 让 5.5KB 的图标 inline 成 base64 data URL(CSP 已允许 `data:` 图片源)。
  - 色谱图例 swatch / 字号统一放大到 2× —— 大图小格时图例太挤看不清。同时把 "By Count / By Code" 改成中文 "按数量 / 按代号"。

## 1.0.1

- Fix: 「版本管理」对话框在 VS Code 扩展里能正常列出和删除快照了。之前 `listSnapshots()` 直接返回 `[]`、`deleteSnapshot()` 抛 "not yet supported",导致对话框打开后永远空、删除按钮报错。host 端新增 `listSnapshots` / `deleteSnapshot` 两个消息:前者枚举 autosave 目录里的 `.pindou` 文件按修改时间倒序返回;后者带路径安全校验(必须是 `.pindou_autosave` 目录下的 `.pindou` 文件),对应桌面端 Tauri `delete_snapshot` 的 canonicalize 校验。

## 1.0.0

- Milestone: VS Code 扩展 1.0,功能与桌面端基本对齐(导入图纸/快照/选区操作/导出等全部可用)。
- Feature: 「导入图纸」在 VS Code 扩展里能用了(之前会抛 "not supported")。完整复用桌面端工作流 —— 本软件导出的 PNG 走元数据快速路径(100% 精确还原),第三方图纸走自动检测路径(per-axis 暗像素密度 + 自相关周期检测 + snap-to-grid-lines + CIELAB ΔE76 颜色匹配 + Otsu 文本/空白格判别)。可拖拽蓝框微调检测区域、手动编辑网格尺寸。整个算法跑在 webview 主线程(无 Web Worker),用 `setTimeout(0)` 每 8~64 行让一次 UI 线程。
- Feature: 检测/导入过程有进度条 + 取消按钮。JS 比 Rust 慢,大图纸可能要几秒;进度条在「确认尺寸」对话框(重新识别)和最终导入遮罩层都会出现。取消按钮通过 `AbortController` 触达算法内部,会被吞掉不上 toast。
- Feature: 图纸导入预览页顶部可直接改 W×H + 点「重新导入」就地刷新结果,不用退回到「确认尺寸」对话框再走一遍。
- Fix: 自动识别尺寸比实际小时(常见于第三方图纸:外圈网格线偏淡 / 蓝底背景渗色被切掉),手填更大的尺寸时多出来的格子会在 origin 左右/上下均分。落在图像外的格子留空(透明),不再只往右下延伸。配合上面的预览页改尺寸,你看到边缘缺一圈 → 直接在预览里改大 → 重新导入 → 缺的格子被补回。

## 0.9.8

- Feature: 选区上方现在浮出一个小药丸「⋮ 右键查看操作」，提示用户右键可以打开镜像/移到图层/复制/原地复制/替换颜色等动作。点这个 chip 本身也能打开同样的菜单（兼容触屏/没鼠标右键的场景）。chip 位置跟随选区顶部右上角，pan/zoom 实时更新；选区在画布顶部边缘时会自动上钳避免被裁。
- Refactor: 替换选区颜色对话框重做。改为「规则列表」式 —— 默认无规则，点「+ 添加替换规则」加一条 `[原色] → [目标色] [×]` 行；原色从选区内已有颜色里选（带计数），目标色从完整 MARD 色板里选（按系列字母分组，可滚动）。色块样式与主色板一致（36×28、显示 MARD 代码而不是序号）。一次可叠加多条规则，「执行替换」按 1→2→3 顺序应用。

## 0.9.7

- Fix: 选区右键菜单点击无反应。两个同因 bug：
  - 菜单按钮的 `mousedown` 未阻止冒泡到 canvas 容器，当当前工具为「选区」且点击坐标在选区外时，`handleMouseDown` 会先调 `clearSelection()`，导致后续菜单 action（`mirrorSelection` / `moveSelectionToNewLayer` 等）读到 `selection==null` 而静默 no-op。
  - 菜单内部的 `Item` 子组件定义在父组件函数体内，PixelCanvas 因选区蚂蚁线动画每 ~100ms 重渲染时，Item 被当成新组件类型，菜单按钮整体 unmount→remount，使部分点击事件无法到达正确的 onClick handler。
  - 修复：菜单根 div 和替换颜色对话框遮罩层都加 `onMouseDown={(e) => e.stopPropagation()}`；`Item` 提升到模块作用域、`onClose` 改为通过 props 注入。

## 0.9.6

- Feature: 选区右键菜单。当画布上存在选区时右键弹出菜单，提供 6 个动作：镜像（水平/垂直子菜单）、移到新图层、移到指定图层（子菜单列出其他图层）、复制、原地复制并拖动、替换选区内颜色（弹小对话框选 from/to，to 可以用当前画笔色）。
- Internal: 5 个新 store action（mirrorSelection / duplicateSelectionAsFloating / replaceColorInSelection / moveSelectionToNewLayer / moveSelectionToLayer）。跨图层移动遵循现有 setActiveLayer/removeLayer 的惯例 — 清空 undo/redo 栈。

## 0.9.5

- Feature: 「版本管理」对话框新增提示：快照只保存在本地应用数据目录，换设备或重装应用会丢失。同时显示一个 (i) 图标，hover 可查看实际存储路径。
- Feature: 每条快照新增「另存为」按钮，可把任意快照导出为独立 `.pindou` 文件到用户选择的位置。VS Code 下走静默 `writeFile`，不会切换当前编辑器（区别于 `saveProject` 的 `saveAs` 行为）。
- Internal: 新增 `PlatformAdapter.writeProjectFile(path, project)` 接口，作为「只写文件、不动编辑器」的导出语义；与 `saveProject` 区分开。VS Code adapter 的 autosave 静默写入路径也复用了它，消除重复逻辑。

## 0.9.4

- Fix: 图层 ↑/↓ 重新排序后，约一分钟左右页面突然刷新、多层内容被合并成一层的问题。根因：
  - `buildProjectFile` 之前只写 `canvasData`（合并视图），不写 `layers` 数组 —— 任何 save/reload 都会把多层折叠成一层。
  - VS Code adapter 的 autosave 走的是 `saveAs` 消息，扩展会用 `vscode.openWith` 打开备份文件并 dispose 当前 webview panel，导致用户看到「页面刷新」+ 图层丢失。
  - 修复一：`ProjectFile` 增加可选 `layers` 字段（v2 格式），保存/加载/快照/云端下载/打开项目时都走层级路径；老 v1 文件保持兼容。
  - 修复二：VS Code adapter 在写入 `autosave.pindou` 时改走静默 `writeFile`，不再触发 saveAs 编辑器切换。

## 0.9.3

- Fix: 「新建图层」、「重命名图层」、「新建自定义色组」、「删除色组」、「删除快照」、「云端覆盖确认」以及导出/导入的成功/失败提示等场景在 VS Code 中之前全部静默失败 —— VS Code webview 禁用了原生 `window.prompt/alert/confirm`。改用应用内模态对话框（`appPrompt/appAlert/appConfirm`），桌面版、浏览器、移动端、VS Code 行为一致。共修复 17 处调用。

## 0.9.2

- Fix: floating preview thumbnail no longer gets stuck off-screen. If a previously saved drag position pushed the panel's drag header above the canvas area, the +/− zoom buttons and the drag handle became invisible (clipped by the canvas container's `overflow-hidden`) and the panel could not be moved back. Positions are now clamped on render and during drag so the header always stays inside the canvas area; stale localStorage values are silently corrected on next interaction.

## 0.9.1

- Fix: the in-app "新建" toolbar button now opens a fresh untitled `.pindou` tab via the extension host (same flow as the `pindouverse.newProject` command) instead of resetting the canvas in place. Previously, after opening an existing file like `kikyou.pindou`, clicking 新建 left the tab and document pointing at the original file — a subsequent Ctrl+S could silently overwrite it.

## 0.8.9

- Feature: image exports (blueprint, preview, and mirrors) now support an optional top "PindouVerse" header band with the app icon, plus opt-in 45° tiled watermarks for the app name and the project author. New "水印与署名" section in the export dialog with a description field, author override, and persistent settings. Header band on by default; author watermark on by default (silently skipped if no author is set).

## 0.8.8

- Feature: eraser tool now has a flyout with two sub-modes — 单格擦除 (single cell, the original behavior) and 区域擦除 (flood-erase, clears all connected cells of the clicked color). Symmetric to the 填充 tool. The last-used sub-mode is sticky via the `E` shortcut.

## 0.8.7

- Improvement: blueprint PNG/JPG export now uses larger, better-centered cell-text. Font multiplier raised from 0.32 → 0.4 (12px at the default 30px cellSize, was ~9.6px), making per-cell color codes legible without zoom.

## 0.8.6

- Fix: "PindouVerse: New Project" no longer leaks the internal temp filename into the project. Save now correctly prompts for a destination instead of silently overwriting the untitled temp file (untitled_<timestamp>.pindou under the extension's globalStorage)

## 0.8.5

- Fix: "另存为" (Save As) now actually writes to the chosen path and switches the active editor to the new file (previously it ignored the new path, silently saved over the original file, and left the editor on the old document)

## 0.8.4

- Fix: image import in VS Code now actually works — file picker opens preview, original size is shown, 🔍 auto-detect grid button appears, and the "预览" / "对比多种组合" buttons produce results (previously all silently failed because previewImage/importImage threw "not yet supported")
- Image is read once via the extension host (`vscode.workspace.fs.readFile`) and decoded in the webview via a `data:` URL + Canvas — same pixel pipeline as the browser adapter, including width-compensation (`widthRatio`)

## 0.8.3

- Fix: exported blueprint PNG now includes the bead-count legend below the grid (two sections: by count, by code) — matches the desktop app output

## 0.8.2

- Fix: preview image (效果图) now exports correctly in VS Code (was throwing "not yet supported")
- Fix: export dialog now closes after export, even if one of multiple files fails
- Improvement: per-file error reporting — one failed export no longer skips the others; success alert lists exactly which files saved and which failed
- Image import: regular image-to-pindou matching now respects user color overrides (was ignoring adjusted colors)
- Blueprint import preview: cells in the preview dialog now render with overridden colors (matched code was already correct)
- Internal: fix lab cache identity-comparison bug that could return stale results when overrides changed

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
