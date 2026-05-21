# 拼豆宇宙 PindouVerse

跨平台拼豆像素艺术编辑器，支持 MARD 295 色板、多图层、图纸模式、语音控制。

**技术栈**: Tauri v2 + React 19 + TypeScript + Vite + Zustand + Tailwind CSS 4

**平台**: Desktop (Windows/macOS) · Browser Extension (Chrome/Edge) · iOS/Android (WIP)

---

## 1. 开发环境初始化

### 前置要求

| 工具 | 版本 | 安装方式 |
|------|------|----------|
| **Node.js** | ≥ 18 | https://nodejs.org |
| **Rust** | ≥ 1.77 | https://rustup.rs |
| **系统依赖** (仅 Linux) | — | 见下方说明 |

**Windows 额外要求**：
- Visual Studio Build Tools (C++ 桌面开发工作负载)
- WebView2 (Windows 10/11 通常已自带)

**macOS 额外要求**：
- Xcode Command Line Tools: `xcode-select --install`
- CLang (随 Xcode 附带)

### 初始化步骤

```bash
# 1. 克隆仓库
git clone <repo-url>
cd pindou

# 2. 安装前端依赖
npm install

# 3. 确认 Rust 工具链可用
rustc --version   # 应输出 ≥ 1.77
cargo --version

# 4. 启动开发模式（自动编译 Rust + 启动 Vite + 打开应用窗口）
npm run tauri dev
```

> **Windows 注意**：如果 `cargo` 未在 PATH 中，先执行：
> ```powershell
> $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
> ```
> 或永久添加到系统 PATH：
> ```powershell
> [Environment]::SetEnvironmentVariable("PATH", "$env:USERPROFILE\.cargo\bin;" + [Environment]::GetEnvironmentVariable("PATH", "User"), "User")
> ```

首次 `tauri dev` 会下载并编译 Rust 依赖（约 500+ crate），耗时 3-10 分钟。后续增量编译约 10-20 秒。

### 常用开发命令

```bash
# Desktop
npm run dev          # 仅启动 Vite 前端 (http://localhost:1420)
npm run tauri dev    # 启动完整 Tauri 应用（推荐）
npm run tauri build  # 构建安装包

# 测试
npm test             # 运行单元测试（Vitest）
npm run test:watch   # 测试监听模式

# 类型检查
npx tsc --noEmit     # TypeScript 类型检查

# 浏览器扩展
npm run ext:dev      # 扩展开发模式
npm run ext:build    # 构建扩展到 platforms/extension/dist/

# 移动端（需要对应平台工具链，详见 platforms/ios/SETUP.md 和 platforms/android/SETUP.md）
npm run ios:init     # 初始化 iOS 项目（仅首次）
npm run ios:dev      # iOS 开发模式
npm run android:init # 初始化 Android 项目（仅首次）
npm run android:dev  # Android 开发模式
```

---

## 2. 打包发布

### 构建安装包

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`：

| 平台 | 产物路径 | 格式 |
|------|----------|------|
| **Windows** | `bundle/nsis/PindouVerse_0.1.0_x64-setup.exe` | NSIS 安装包 |
| **Windows** | `bundle/msi/PindouVerse_0.1.0_x64_en-US.msi` | MSI 安装包 |
| **macOS** | `bundle/dmg/PindouVerse_0.1.0_aarch64.dmg` | DMG 磁盘映像 |
| **macOS** | `bundle/macos/PindouVerse.app` | App Bundle |

### 仅构建特定格式

```bash
# Windows — 仅 NSIS 安装包
npm run tauri build -- --bundles nsis

# Windows — 仅 MSI
npm run tauri build -- --bundles msi

# macOS — 仅 DMG
npm run tauri build -- --bundles dmg

# macOS — 仅 App Bundle
npm run tauri build -- --bundles app
```

### 准备 macOS 图标

在 macOS 上打包前，需要生成 `.icns` 图标文件：

```bash
# 准备一张 1024x1024 的 PNG 图标，命名为 app-icon.png，放在项目根目录
npx tauri icon app-icon.png
```

这会自动在 `src-tauri/icons/` 下生成所有平台需要的图标格式（包括 `icon.icns`）。

生成后，在 `src-tauri/tauri.conf.json` 的 `bundle.icon` 中加入：

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.ico",
  "icons/icon.icns"
]
```

---

## 3. 迁移与安装到其他系统

### 方式 A：直接发送安装包（推荐）

在当前机器上打包后，将安装包文件发送到目标系统即可。

**发送到 Windows**：
1. 将 `.exe` 或 `.msi` 文件拷贝到目标 Windows 电脑
2. 双击运行安装，按提示完成

**发送到 macOS**：
1. 将 `.dmg` 文件拷贝到目标 Mac
2. 双击打开 DMG，将 `PindouVerse.app` 拖入 `Applications` 文件夹
3. 首次打开时，右键点击 App → 选择"打开"（绕过 Gatekeeper 未签名提示）

> **跨平台构建限制**：Tauri 不支持在 Windows 上构建 macOS 安装包，反之亦然。需要在目标平台上构建对应的安装包。

### 方式 B：在目标 Mac 上从源码构建

```bash
# 1. 安装前置工具
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 2. 安装 Node.js (推荐用 nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22

# 3. 克隆并构建
git clone <repo-url>
cd pindou
npm install
npm run tauri build

# 4. 安装
open src-tauri/target/release/bundle/dmg/*.dmg
```

### 方式 C：GitHub Actions 自动化 CI/CD（可选）

在 `.github/workflows/release.yml` 中配置跨平台构建矩阵，实现一次提交自动出 Windows + macOS 安装包。示例配置可参考 [Tauri 官方 CI 文档](https://v2.tauri.app/distribute/ci-cd/)。

---

## 项目结构

```
pindou/
├── src/                          # React 前端（跨平台共享）
│   ├── adapters/                 # 平台适配层
│   │   ├── index.ts              # PlatformAdapter 接口定义
│   │   ├── tauri.ts              # Desktop 实现 (Tauri IPC)
│   │   ├── browser.ts            # 浏览器扩展实现 (IndexedDB + Canvas API)
│   │   └── mobile.ts             # 移动端实现 (继承 Tauri + share)
│   ├── components/
│   │   ├── Canvas/               # 画布 + 工具栏 + 图纸模式
│   │   ├── Palette/              # MARD 295 色板（分组/搜索）
│   │   ├── Import/               # 图片导入（放大镜/区域选择/对比）
│   │   ├── Export/               # 高分辨率导出（网格/图例/镜像）
│   │   └── Stats/                # 拼豆用量统计
│   ├── hooks/
│   │   └── useVoiceControl.ts    # 语音控制 Hook (Web Speech API)
│   ├── data/mard221.ts           # MARD 295 色定义 + 色系分组
│   ├── store/editorStore.ts      # Zustand 状态管理（多图层/蓝图/网格）
│   ├── utils/
│   │   ├── canvasRenderer.ts     # Canvas 2D 渲染（像素/网格/蓝图）
│   │   ├── colorConversion.ts    # RGB ↔ CIELAB 转换
│   │   ├── colorMatching.ts      # 颜色匹配算法
│   │   ├── audioFeedback.ts      # 语音提示音 (Web Audio API)
│   │   └── llmVoice.ts           # LLM 语音增强 (GitHub Models API)
│   └── types/index.ts            # TypeScript 类型
├── src-tauri/                    # Rust 后端
│   ├── src/commands/
│   │   ├── image_import.rs       # 图片导入/缩放
│   │   ├── image_export.rs       # 高分辨率导出
│   │   ├── project.rs            # 项目保存/加载/快照
│   │   ├── mobile.rs             # 移动端命令
│   │   └── github_auth.rs        # GitHub OAuth + LLM API 代理
│   ├── src/color/                # CIELAB 颜色匹配
│   ├── fonts/                    # 导出用字体 (Noto Sans Mono)
│   └── tauri.conf.json           # Tauri 配置
├── platforms/
│   ├── extension/                # Chrome/Edge 浏览器扩展
│   ├── ios/                      # iOS 平台 (WIP)
│   └── android/                  # Android 平台 (WIP)
├── tests/
│   └── core/                     # 核心逻辑单元测试 (Vitest)
├── scripts/                      # 工具脚本（图标生成等）
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 功能概览

- **MARD 295 色板** — 15 个色系分组，支持搜索和筛选
- **多图层系统** — 参考图层 + 拼豆图层 + 自定义图层，独立透明度/可见性
- **图纸模式** — 实时蓝图预览，浮动坐标轴，网格聚焦（双击/方向键/语音）
- **镜像模式** — 蓝图翻转查看拼豆背面视角，支持镜像编辑
- **图片导入** — 放大镜预览，区域裁切，算法对比（Euclidean/CIEDE2000）
- **高分辨率导出** — 网格线 + 色号 + 坐标轴 + 色彩图例 + 镜像导出
- **语音控制** — Web Speech API 语音指令移动网格聚焦，可选 LLM AI 增强
- **项目管理** — 保存/加载 .pindou 项目文件，自动保存，版本快照
- **跨平台** — Desktop (Tauri) + Browser Extension + iOS/Android (WIP)


## License

Non-commercial use only. Source code is licensed under the
[**PolyForm Noncommercial 1.0.0**](https://polyformproject.org/licenses/noncommercial/1.0.0)
license; sample bead-art designs in `samples/` are licensed under
[**CC BY-NC 4.0**](https://creativecommons.org/licenses/by-nc/4.0/).

Personal hobby, study, research, and educational / charitable use are
explicitly permitted. **Individuals selling physical bead artwork they
produced using this software is NOT Commercial Use** of the software
(the sample designs themselves remain non-commercial — see
`samples/LICENSE`).

For full terms, exceptions, and the commercial-licensing contact path,
see [`LICENSE`](./LICENSE) and [`LICENSE-CODE`](./LICENSE-CODE).

Releases through 0.8.9 (and PindouVerse 1.0.x desktop) remain available
under MIT — that grant is irrevocable. This non-commercial license
applies to releases from 0.8.10 / 1.2.0 onward.
