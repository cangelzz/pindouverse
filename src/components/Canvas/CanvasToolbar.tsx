import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import type { EditorTool } from "../../types";
import { hasToken, clearGitHubToken, requestDeviceCode, pollForToken, type DeviceCodeInfo } from "../../utils/llmVoice";

const tools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "pen", label: "画笔", icon: "✏️", shortcut: "P" },
  { id: "fill", label: "填充", icon: "🪣", shortcut: "F" },
  { id: "eraser", label: "橡皮", icon: "🧹", shortcut: "E" },
  { id: "eyedropper", label: "取色", icon: "💧", shortcut: "I" },
  { id: "pan", label: "平移", icon: "✋", shortcut: "Space" },
];

export function CanvasToolbar() {
  const currentTool = useEditorStore((s) => s.currentTool);
  const setTool = useEditorStore((s) => s.setTool);

  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [authStatus, setAuthStatus] = useState("");
  const [isAuthPolling, setIsAuthPolling] = useState(false);
  const [hasLLM, setHasLLM] = useState(hasToken());

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const blueprintMode = useEditorStore((s) => s.blueprintMode);
  const setBlueprintMode = useEditorStore((s) => s.setBlueprintMode);
  const blueprintMirror = useEditorStore((s) => s.blueprintMirror);
  const setBlueprintMirror = useEditorStore((s) => s.setBlueprintMirror);
  const gridFocusMode = useEditorStore((s) => s.gridFocusMode);
  const setGridFocusMode = useEditorStore((s) => s.setGridFocusMode);
  const voiceControlEnabled = useEditorStore((s) => s.voiceControlEnabled);
  const setVoiceControlEnabled = useEditorStore((s) => s.setVoiceControlEnabled);
  const aiVoiceEnabled = useEditorStore((s) => s.aiVoiceEnabled);

  return (
    <div className="flex flex-col gap-1 p-2 bg-gray-50 border-r w-12 items-center select-none">
      {/* Tools */}
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
            ${currentTool === t.id ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={`${t.label} (${t.shortcut})`}
        >
          {t.icon}
        </button>
      ))}

      <div className="border-t my-1 w-full" />

      {/* Undo/Redo */}
      <button
        onClick={undo}
        disabled={undoStack.length === 0}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200 disabled:opacity-30"
        title="撤销 (Ctrl+Z)"
      >
        ↩
      </button>
      <button
        onClick={redo}
        disabled={redoStack.length === 0}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200 disabled:opacity-30"
        title="重做 (Ctrl+Y)"
      >
        ↪
      </button>

      <div className="border-t my-1 w-full" />

      {/* Zoom */}
      <button
        onClick={() => setZoom(zoom * 1.25)}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200"
        title="放大"
      >
        +
      </button>
      <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
      <button
        onClick={() => setZoom(zoom / 1.25)}
        className="w-9 h-9 rounded flex items-center justify-center text-lg hover:bg-gray-200"
        title="缩小"
      >
        −
      </button>
      <button
        onClick={() => setZoom(1)}
        className="w-9 h-7 rounded flex items-center justify-center text-xs hover:bg-gray-200"
        title="重置缩放"
      >
        1:1
      </button>

      <div className="border-t my-1 w-full" />

      {/* Blueprint mode toggle */}
      <button
        onClick={() => setBlueprintMode(!blueprintMode)}
        className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
          ${blueprintMode ? "bg-orange-500 text-white shadow" : "hover:bg-gray-200"}`}
        title={blueprintMode ? "退出图纸模式" : "图纸模式"}
      >
        📋
      </button>

      {/* Mirror toggle (only in blueprint mode) */}
      {blueprintMode && (
        <button
          onClick={() => setBlueprintMirror(!blueprintMirror)}
          className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
            ${blueprintMirror ? "bg-purple-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={blueprintMirror ? "退出镜像" : "镜像（背面视角）"}
        >
          🪞
        </button>
      )}

      {/* Grid focus toggle (only in blueprint mode) */}
      {blueprintMode && (
        <button
          onClick={() => setGridFocusMode(!gridFocusMode)}
          className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
            ${gridFocusMode ? "bg-teal-500 text-white shadow" : "hover:bg-gray-200"}`}
          title={gridFocusMode ? "退出网格聚焦" : "网格聚焦（双击/方向键选中5×5区域）"}
        >
          🔲
        </button>
      )}

      {/* Voice control toggle (only in blueprint + grid focus mode) */}
      {blueprintMode && gridFocusMode && (
        <button
          onClick={() => setVoiceControlEnabled(!voiceControlEnabled)}
          className={`w-9 h-9 rounded flex items-center justify-center text-sm transition-colors
            ${voiceControlEnabled ? "bg-red-500 text-white shadow animate-pulse" : "hover:bg-gray-200"}`}
          title={voiceControlEnabled ? "关闭语音控制" : "语音控制（说 上下左右 移动聚焦）"}
        >
          🎤
        </button>
      )}

      {/* AI voice enhancement toggle (only when feature enabled) */}
      {blueprintMode && gridFocusMode && aiVoiceEnabled && (
        <button
          onClick={() => {
            if (hasLLM) {
              clearGitHubToken();
              setHasLLM(false);
            } else {
              setShowTokenDialog(true);
              setAuthStatus("正在请求验证码...");
              setDeviceInfo(null);
              requestDeviceCode().then((info) => {
                setDeviceInfo(info);
                setAuthStatus("请在浏览器中输入验证码");
                // Open verification URL in system browser
                import("@tauri-apps/plugin-shell").then(({ open }) => open(info.verification_uri)).catch(() => {
                  window.open(info.verification_uri, "_blank");
                });
                // Start polling
                setIsAuthPolling(true);
                pollForToken(info.device_code, info.interval, info.expires_in, setAuthStatus).then((ok) => {
                  setIsAuthPolling(false);
                  if (ok) {
                    setHasLLM(true);
                    setTimeout(() => setShowTokenDialog(false), 1000);
                  }
                });
              }).catch((e) => {
                setAuthStatus(`请求失败: ${e.message}`);
              });
            }
          }}
          className={`w-9 h-7 rounded flex items-center justify-center text-[9px] transition-colors
            ${hasLLM ? "bg-green-500 text-white shadow" : "hover:bg-gray-200 text-gray-400"}`}
          title={hasLLM ? "AI增强已开启（点击登出）" : "登录GitHub开启AI语音增强"}
        >
          AI
        </button>
      )}

      {/* GitHub OAuth Device Flow Dialog */}
      {showTokenDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h3 className="font-semibold text-sm mb-2">登录 GitHub — AI 语音增强</h3>
            {deviceInfo ? (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  请在浏览器中打开下方链接，输入验证码完成授权：
                </p>
                <div className="flex flex-col items-center gap-2 mb-3">
                  <a
                    href={deviceInfo.verification_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 text-xs underline"
                  >
                    {deviceInfo.verification_uri}
                  </a>
                  <div className="text-2xl font-mono font-bold tracking-widest bg-gray-100 px-4 py-2 rounded select-all">
                    {deviceInfo.user_code}
                  </div>
                </div>
                <p className="text-xs text-center text-gray-500">
                  {isAuthPolling && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-1" />}
                  {authStatus}
                </p>
              </>
            ) : (
              <p className="text-xs text-gray-500 text-center py-4">{authStatus}</p>
            )}
            <div className="flex justify-end mt-3">
              <button
                onClick={() => { setShowTokenDialog(false); setDeviceInfo(null); }}
                className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              >
                {isAuthPolling ? "取消" : "关闭"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
