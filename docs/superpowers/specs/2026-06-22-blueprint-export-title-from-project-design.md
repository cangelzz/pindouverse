# 导出图纸标题来自项目属性 — 设计文档

日期:2026-06-22
状态:已批准设计,待写实现计划

## 背景

导出对话框(`src/components/Export/ExportDialog.tsx`)的图纸/效果图顶部有一条标题栏,渲染为 `PindouVerse - <标题> - <作者>`。

现状:

- **作者**已从「项目信息」的 `projectInfo.author` 提取(`resolveWatermarkAuthor` 优先取项目作者,localStorage 里的 `authorOverride` 仅作回退)。
- **标题**目前是导出对话框里一个手动填写、存在 localStorage 的「描述(可选)」字段(`ExportWatermarkSettings.appDescription`),**并未**关联到 `projectInfo.title`。

## 目标

让标题也从项目属性(`projectInfo.title`)提取,与作者对称。标题严格来自 `title` 属性——不回退到 `description`。当项目尚无标题时,允许在导出对话框里填写,并在导出时把它写回 `projectInfo.title`(即「为项目补上 title 属性」)。

## 非目标(不在范围)

- weapp / h5 平台的导出(独立代码库)。
- 作者逻辑(已实现,保持不变)。
- PNG 元数据嵌入。
- 任意自定义水印文案。
- **`ProjectInfo.description`(项目信息里的「描述」)保留不动**:字段、项目信息对话框 UI、`.pindou` 持久化全部不变,仅在导出时不再被用作标题。本次删除的是 `ExportWatermarkSettings.appDescription`(导出对话框里手填的水印「描述」字段),与之无关。

## 方案

采用「彻底用项目标题取代手填描述」:删除 `appDescription`,标题来源改为 `projectInfo.title`,UX 与作者字段对称,并在无标题时支持写回。

### 1. `ExportDialog.tsx`

- 新增本地状态 `titleInput`,初值 `projectInfo?.title ?? ""`;记录 `hadProjectTitle = !!(projectInfo?.title ?? "").trim()`。
- 顶部「应用标题(icon + PindouVerse)」勾选项(`showHeader`)下方的输入框:
  - `projectInfo.title` 非空 → 输入框**只读**(disabled),展示该标题,下方提示「标题来自当前项目设置,优先使用」。
  - `projectInfo.title` 为空 → 输入框**可编辑**,占位提示「(未设置,填写后将保存到项目信息)」。
  - 该结构与现有「作者」字段(`projectAuthor ? 只读 : 可编辑覆盖`)完全对称。
- header payload 改为:
  ```ts
  app_description: composeHeaderDescription(titleInput.trim(), resolvedAuthor)
  ```
- 导出时写回(仅当原项目无标题且用户填了标题):
  ```ts
  const t = titleInput.trim();
  if (!hadProjectTitle && t) {
    setProjectInfo({ ...(projectInfo ?? {}), title: t });
  }
  ```
  `setProjectInfo` 会置 `isDirty: true`,标题随项目保存写入 `.pindou`。写回在实际触发导出(用户已选好保存路径、开始导出)后进行,取消导出不写回。

### 2. `blueprintDecorations.ts` / `types/index.ts`

- 从 `ExportWatermarkSettings` 删除 `appDescription` 字段。
- 从 `DEFAULT_WATERMARK_SETTINGS` 删除 `appDescription: ""`。
- `composeHeaderDescription(title, author)` 是纯函数,语义不变,保留。
- `loadWatermarkSettings` / `saveWatermarkSettings` 逻辑不变(只是少一个字段);历史 localStorage 里残留的 `appDescription` 会被忽略,无害。

### 3. 测试

- `src/utils/blueprintDecorations.test.ts`:把引用 `appDescription` 的持久化用例改为断言另一个保留字段(如 `authorOverride`)的存取,确保 load/save 仍覆盖。`composeHeaderDescription` 既有用例不变。
- `platforms/vscode/tests/export.spec.ts`(Playwright,webview):
  - 项目设了 `projectInfo.title` 时,导出 header 文本包含该标题(经 `composeHeaderDescription`)。
  - 项目无标题时,在标题输入框填值并导出,断言 store 的 `projectInfo.title` 被写回为该值。
  - 用 `callAction`/`stageReply` 等既有 helper 完成 setup 与断言,不手造 canvas 事件。

## 数据流

```
projectInfo.title ──(ExportDialog: titleInput)──> composeHeaderDescription
        │                                                   │
        │                                          watermark.app_description
        │                                                   │
        │                                  adapter.exportImage / exportPreview ──> drawHeader
        │
        └──(无标题时填写并导出)──> setProjectInfo ──> store(isDirty) ──> 保存写入 .pindou
```

## 影响面

- 共享组件 `ExportDialog` 由桌面端(Tauri,`src/adapters/browser.ts` 渲染)与 VS Code webview 共用,两端同时受益。
- 删除 `appDescription` 是面向类型的小改动,影响点集中在 `ExportDialog.tsx`、`types/index.ts`、`blueprintDecorations.ts` 与一处单测。

## 风险与取舍

- **localStorage 兼容**:旧数据含 `appDescription`,删除字段后被忽略,不会报错(`loadWatermarkSettings` 以默认值做并集)。
- **写回时机**:仅在导出真正开始时写回,避免用户只是打开对话框看看就污染项目数据。
- **只读判定**:以「打开对话框那一刻项目是否已有标题」(`hadProjectTitle`)为准,避免写回后输入框状态抖动。
