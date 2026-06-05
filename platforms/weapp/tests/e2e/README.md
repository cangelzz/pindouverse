# PinDou Miniapp — E2E Tests

End-to-end tests use the official [`miniprogram-automator`](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/) package to drive the WeChat DevTools, open the compiled `dist/`, and exercise real navigation/storage flows.

## Prerequisites

1. **WeChat DevTools** installed (`微信开发者工具`). The HTTP automation server must be enabled (Settings → Security → "服务端口" / "CLI/HTTP 调用").
2. The miniapp must be built first: `npm run build:weapp`.
3. The `WX_DEVTOOLS_CLI` env var should point to the devtools CLI (Windows defaults are auto-detected):
   - Windows: `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`
   - macOS: `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`

## Running

```pwsh
# build + e2e in one shot
npm run test:e2e:build

# if dist/ is already current
npm run test:e2e
```

Tests run serially (`maxWorkers: 1`) because each suite owns the devtools session.

## File layout

| File | Purpose |
|------|---------|
| `helpers.ts` | CLI path resolution + `launchMiniProgram()` boots devtools against `platforms/weapp/dist`. |
| `automator.d.ts` | Type shims for `miniprogram-automator` (the npm package ships without types). |
| `smoke.test.ts` | Boot + entry page + tab switch + empty state. |
| `projects.test.ts` | Seeds `pindou:projects` storage, taps an item, asserts navigation to result page; tests delete flow with `mockWxMethod('showModal', ...)`. |

## Adding a test

```ts
import { launchMiniProgram } from './helpers';

let mp: import('miniprogram-automator').MiniProgram;
beforeAll(async () => { mp = await launchMiniProgram(); }, 90_000);
afterAll(async () => { await mp?.close().catch(() => undefined); });

it('does the thing', async () => {
  const page = await mp.reLaunch('/pages/import/index');
  // ...
});
```

Use `mp.callWxMethod('setStorage', { key, data })` to seed state, and `mp.mockWxMethod` / `restoreWxMethod` to stub modal/permission dialogs.
