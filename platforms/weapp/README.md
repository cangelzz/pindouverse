# PinDou WeChat Miniapp (`platforms/weapp`)

Taro 4 + React 18 → 微信小程序。共享 `platforms/h5/packages/core` 的颜色匹配 / 调色板。

## 本地开发

```bash
cd platforms/weapp
npm install
npm run dev:weapp        # taro build --type weapp --watch，输出到 ./dist
```

微信开发者工具：导入项目目录 `platforms/weapp`，工具会读取 `project.config.json`（指向 `dist/`）。

## AppID

`project.config.json` 里的 `appid` 是占位 `touristappid`，开发者工具会自动用游客模式。
要用真实 AppID：复制 `project.config.json` 为 `project.private.config.json`（已 gitignore），改 `appid` 字段。

## 构建产物

```bash
npm run build:weapp      # 一次性构建，输出 dist/
```

## 目录

```
src/
  app.tsx              # Taro App 根
  app.config.ts        # pages + tabBar 注册
  pages/
    home/              # 首页
    import/            # 导入（F2 接入）
    projects/          # 我的作品（F4 接入）
  assets/tab/          # tabBar 图标
config/                # Taro build config
project.config.json    # 微信开发者工具
```
