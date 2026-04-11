/**
 * LLM-based voice command matching using GitHub Models API.
 * Requires a GitHub Personal Access Token (PAT) with Copilot access.
 *
 * Endpoint: https://models.inference.ai.azure.com/chat/completions
 * Model: gpt-4o-mini (fast, cheap, good enough for command parsing)
 */

import type { VoiceCommand } from "../hooks/useVoiceControl";

export interface LLMCommandResult {
  command: VoiceCommand;
  fromLLM: boolean;
  repeat?: number;
  gotoCol?: number;
  gotoRow?: number;
  debug?: string;  // raw LLM response for debugging
}

const GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com/chat/completions";
const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are a voice command parser for a pixel bead art editor.
The user speaks Chinese or English voice commands to control grid navigation.
The grid is a 5×5 bead board. Commands move a highlight focus between grid groups.

IMPORTANT: The input comes from speech recognition and may contain:
- Chinese numbers (三→3, 十五→15, 二十→20)
- Homophones (尚→上, 又→右, 虾→下)
- Speech errors and partial words

Respond with a JSON object ONLY (no markdown, no explanation):

Directional moves:
  {"command":"up|down|left|right","repeat":N}
  repeat defaults to 1. Examples:
  - "上" → {"command":"up","repeat":1}
  - "向左两次" / "左两下" → {"command":"left","repeat":2}
  - "右三下" / "右三次" → {"command":"right","repeat":3}
  - "上上上" → {"command":"up","repeat":3}

Move to edge (最上/最下/最左/最右):
  {"command":"up|down|left|right","repeat":99}
  - "移动到最上面" / "最上" / "到顶" → {"command":"up","repeat":99}
  - "移动到最下面" / "最下" / "到底" → {"command":"down","repeat":99}
  - "移动到最左边" / "最左" → {"command":"left","repeat":99}
  - "移动到最右边" / "最右" → {"command":"right","repeat":99}

Positioning by coordinates:
  {"command":"goto","col":X,"row":Y}
  Numbers can be Chinese (三→3) or Arabic. First number is column, second is row.
  - "定位到3,5" / "定位到三五" → {"command":"goto","col":3,"row":5}
  - "跳到第2列第4行" / "跳到二列四行" → {"command":"goto","col":2,"row":4}
  - "去10,20" / "去十二十" → {"command":"goto","col":10,"row":20}
  - "定位到15 20" / "定位到十五二十" → {"command":"goto","col":15,"row":20}

Other commands:
  {"command":"cancel|confirm|summary"}
  - 取消/关闭/清除 → {"command":"cancel"}
  - 确认/完成/好了 → {"command":"confirm"}
  - 总结/统计/报告/播报/数一下 → {"command":"summary"}

If unrecognizable: {"command":"unknown"}
Always respond with valid JSON only.`;

let _token: string | null = null;

const GITHUB_CLIENT_ID = "Ov23libthPsNlBTIBZHs";

export function setGitHubToken(token: string) {
  _token = token;
  try {
    localStorage.setItem("pindouverse_github_token", token);
  } catch { /* ignore */ }
}

export function getGitHubToken(): string | null {
  if (_token) return _token;
  try {
    _token = localStorage.getItem("pindouverse_github_token");
  } catch { /* ignore */ }
  return _token;
}

export function clearGitHubToken() {
  _token = null;
  try {
    localStorage.removeItem("pindouverse_github_token");
  } catch { /* ignore */ }
}

export function hasToken(): boolean {
  return !!getGitHubToken();
}

// ─── GitHub Device Flow OAuth ────────────────────────────────────

export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Step 1: Request a device code from GitHub (via Rust backend).
 */
export async function requestDeviceCode(): Promise<DeviceCodeInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<DeviceCodeInfo>("github_request_device_code");
}

/**
 * Step 2: Poll GitHub until user authorizes (via Rust backend).
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onStatus?: (status: string) => void,
): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  const deadline = Date.now() + expiresIn * 1000;
  const pollInterval = Math.max(interval, 5) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    try {
      const data = await invoke<{ access_token: string | null; error: string | null }>("github_poll_token", { deviceCode });

      if (data.access_token) {
        setGitHubToken(data.access_token);
        onStatus?.("授权成功！");
        return true;
      }

      if (data.error === "authorization_pending") {
        onStatus?.("等待授权...");
        continue;
      }

      if (data.error === "slow_down") {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (data.error === "expired_token" || data.error === "access_denied") {
        onStatus?.(data.error === "expired_token" ? "验证码已过期" : "授权被拒绝");
        return false;
      }

      onStatus?.(`错误: ${data.error}`);
      return false;
    } catch (e) {
      onStatus?.("网络错误，重试中...");
    }
  }

  onStatus?.("验证码已过期");
  return false;
}

/**
 * Use LLM to parse a voice transcript into a command.
 * Returns the command and whether LLM was actually used.
 */
export async function llmMatchCommand(
  transcript: string
): Promise<LLMCommandResult> {
  const token = getGitHubToken();
  if (!token) {
    return { command: "unknown", fromLLM: false };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("github_models_chat", {
      token,
      transcript,
      systemPrompt: SYSTEM_PROMPT,
    });

    // Parse JSON response from LLM
    const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();
    console.log("[LLM] transcript:", transcript, "→ raw:", raw, "→ cleaned:", cleaned);
    const data = JSON.parse(cleaned);

    const validCommands: VoiceCommand[] = ["up", "down", "left", "right", "cancel", "confirm", "summary", "goto"];
    const command = validCommands.includes(data.command) ? data.command as VoiceCommand : "unknown";

    return {
      command,
      fromLLM: true,
      repeat: typeof data.repeat === "number" ? Math.max(1, Math.min(99, data.repeat)) : undefined,
      gotoCol: typeof data.col === "number" ? data.col : undefined,
      gotoRow: typeof data.row === "number" ? data.row : undefined,
      debug: cleaned,
    };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return { command: "unknown", fromLLM: true, debug: `ERR: ${errMsg}` };
  }
}
