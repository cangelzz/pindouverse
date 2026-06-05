# 微信小程序实现 —— 设计文档

日期：2026-05-29 · 集成分支：`miniapp/base`

## 1. 目标与非目标

**目标**

- 在 `pindou.wechat` 仓库内实现一个**原生发布**的微信小程序，承担拍照/相册 → 拼豆图纸的核心用户路径。
- 与现有 H5/桌面端共享 `@pindou/core`（颜色匹配、调色板数据、渲染算法）的源码层逻辑，避免重复维护。
- 提供可在微信开发者工具中跑通的"线上模拟"测试框架，遵循官方开发流程（`project.config.json` + miniprogram-automator + jest）。

**非目标**

- 不重写 Tauri/VS Code/H5 现有产品。
- 不引入 Taro 的 H5/RN 多端出包（只保留 weapp 一个目标平台，避免配置爆炸）。
- 不接入支付、订阅消息、客服等微信生态高级能力。

## 2. 技术路径决策

| 选项 | 复用度 | 编辑器移植成本 | 风险 | 决策 |
|------|--------|----------------|------|------|
| **Taro 4 (React→weapp)** | 高（core + 部分组件可直接搬） | 中（Canvas 用 Taro `<Canvas>` 包一层） | Taro 与 React 19 兼容性需固定 18.x | **采用** |
| 原生 wxml/wxss/js | 低（core 通过 npm 包形式打包） | 高（全部重写） | 编辑器交互复杂，迭代慢 | 放弃 |
| uni-app (Vue) | 几乎为零 | 高 | 与现有 React 代码无法共享 | 放弃 |
| H5 + WebView 内嵌 | 最高 | 零 | 拿不到原生 API，审核风险 | 放弃 |

### 关键约束

- Taro 4 的 React 渲染器基于 React 18，**weapp 子项目锁定 react@18.3.x**。core 包零 React 依赖，不受影响。
- 微信小程序 Canvas 2D API 与 HTML5 略有不同（需 `wx.createSelectorQuery` 取 Canvas node），编辑器组件需要一层薄适配。

## 3. 目录与分支结构

```
platforms/
  h5/        ← 原 platforms/miniapp 重命名（H5 PWA）
  weapp/     ← 新建，Taro 4 项目，输出微信小程序
  vscode/
  extension/
  android/
  ios/
```

H5 子项目内的 `@pindou/core`、`@pindou/server` 保持不变，weapp 通过相对路径或 `file:` 依赖引用同一个 core 源码。

### 分支策略

- `main` —— 用户专属，AI 不直接提交。
- `miniapp/base` —— 集成分支，所有 weapp 工作的目标。
- `miniapp/feat-<name>` —— 各功能特性分支，squash 合并回 `miniapp/base`。
- 用户在 `miniapp/base` 验证后自行合并到 `main`。

## 4. 功能切片

| ID | 分支 | 范围 | 状态 |
|----|------|------|------|
| F1 | `miniapp/feat-foundation` | 重命名 H5、Taro 脚手架、Tab Bar、3 个空页面（首页/导入/我的） | 进行中 |
| F2 | `miniapp/feat-import` | `chooseMedia` 取图 → core `matchImageToMard` → 像素预览页 | 待 |
| F3 | `miniapp/feat-editor` | PixelCanvas 移植：拖动/缩放/画/擦/油漆桶/撤销 | 待（最大块） |
| F4 | `miniapp/feat-projects` | wx.setStorage 本地保存作品列表、加载、删除 | 待 |
| F5 | `miniapp/feat-login` | `wx.login` + 后端 `jscode2session` 真接入（非首批） | 后续 |
| F6 | `miniapp/feat-export` | 画布转图保存到相册、生成分享卡片 | 后续 |
| F7 | `miniapp/feat-cloud-sync` | 云端作品同步（接 Express server） | 后续 |
| Ft | `miniapp/feat-tests` | miniprogram-automator + jest 模拟测试框架 | 后续 |

## 5. 共享 core 的接入方式

weapp 的 `package.json` 用相对路径声明：

```json
{
  "dependencies": {
    "@pindou/core": "file:../../platforms/h5/packages/core"
  }
}
```

Taro 默认会把 `node_modules` 内依赖按 ESM 编译进 weapp 包。core 全部是纯 TS + 零运行时副作用，安全。

## 6. AppID 与本地配置

- `platforms/weapp/project.config.json` 的 `appid` 字段写占位 `"touristappid"`，并在 `project.private.config.json`（已 gitignore）里覆盖真实 AppID。
- 开发期 `wx.login` 用 mock：`__DEV__` 标志下直接返回固定 `openid`，避免拉起真后端。

## 7. 测试框架（F-tests）

遵循官方文档：<https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/>

- 用 `miniprogram-automator` 启动开发者工具 → 加载编译产物 → 模拟点击/输入 → 断言页面状态。
- jest 作为测试 runner，命令 `npm run test:e2e` 一次性跑通：启动开发者工具 CLI → 编译 Taro 产物 → 跑用例 → 收尾。
- CI 暂不接（开发者工具需 GUI），本地手动跑。

## 8. 风险

1. **Taro 4 + React 19 不兼容** —— 通过 weapp 子项目独立锁版本解决。
2. **Canvas 2D 编辑器在低端机性能** —— F3 阶段做性能 profiling，必要时降级（限制画布最大尺寸 / 关闭抗锯齿）。
3. **AppID 缺失** —— 开发期用占位与 mock 不阻塞。
4. **审核合规** —— 用户上传图片需提示隐私政策；F2 阶段加 toast。

## 9. 验收

- `miniapp/base` 上：`cd platforms/weapp && npm install && npm run dev:weapp` 可生成 `dist/`。
- 微信开发者工具打开 `platforms/weapp/dist` 显示 Tab Bar + 3 个页面。
- 之后每个 feature 合并前在分支上自测一次后再 squash。
