import * as fs from 'fs';
import * as path from 'path';
import automator, { MiniProgram } from 'miniprogram-automator';

/**
 * Shared launcher used by both globalSetup and individual tests.
 * The devtools CLI path is resolved from $WX_DEVTOOLS_CLI (preferred) or a
 * small list of standard locations. The compiled miniapp is expected at
 * `<repo>/platforms/weapp/dist`.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DIST_PATH = path.join(REPO_ROOT, 'dist');

const DEFAULT_WIN_CLI = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat';
const DEFAULT_MAC_CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

export function resolveCliPath(): string {
  if (process.env.WX_DEVTOOLS_CLI && fs.existsSync(process.env.WX_DEVTOOLS_CLI)) {
    return process.env.WX_DEVTOOLS_CLI;
  }
  if (process.platform === 'win32' && fs.existsSync(DEFAULT_WIN_CLI)) {
    return DEFAULT_WIN_CLI;
  }
  if (process.platform === 'darwin' && fs.existsSync(DEFAULT_MAC_CLI)) {
    return DEFAULT_MAC_CLI;
  }
  throw new Error(
    'WeChat devtools CLI not found. Set WX_DEVTOOLS_CLI to the cli executable, ' +
      'or install devtools at the default location.'
  );
}

export function ensureDistBuilt(): void {
  if (!fs.existsSync(DIST_PATH) || !fs.existsSync(path.join(DIST_PATH, 'app.js'))) {
    throw new Error(
      `Compiled miniapp not found at ${DIST_PATH}. Run "npm run build:weapp" first ` +
        '(or use "npm run test:e2e:build").'
    );
  }
}

export async function launchMiniProgram(): Promise<MiniProgram> {
  ensureDistBuilt();
  const cliPath = resolveCliPath();
  return automator.launch({
    projectPath: DIST_PATH,
    cliPath,
    timeout: 60_000,
  });
}
