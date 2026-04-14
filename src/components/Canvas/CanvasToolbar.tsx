import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import type { EditorTool } from "../../types";
import { hasToken } from "../../utils/llmVoice";

const tools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "select", label: "选区", icon: "⬚", shortcut: "S" },
  { id: "wand", label: "魔棒", icon: "✦", shortcut: "W" },
  { id: "pen", label: "画笔", icon: "✏️", shortcut: "P" },
  { id: "fill", label: "填充", icon: "🪣", shortcut: "F" },
  { id: "eraser", label: "橡皮擦", icon: "🩹", shortcut: "E" },
  { id: "eyedropper", label: "取色", icon: "💧", shortcut: "I" },
  { id: "pan", label: "平移", icon: "✋", shortcut: "Space" },
];

const shapeTools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "line", label: "直线", icon: "⟋", shortcut: "L" },
  { id: "rect", label: "矩形", icon: "⬜", shortcut: "R" },
  { id: "circle", label: "圆形", icon: "⭕", shortcut: "C" },
];

export function CanvasToolbar() {
  const currentTool = useEditorStore((s) => s.currentTool);
  const setTool = useEditorStore((s) => s.setTool);

  const [showShapeMenu, setShowShapeMenu] = useState(false);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const fitToWindow = useEditorStore((s) => s.fitToWindow);
  const blueprintMode = useEditorStore((s) => s.blueprintMode);
  const setBlueprintMode = useEditorStore((s) => s.setBlueprintMode);
  const blueprintMirror = useEditorStore((s) => s.blueprintMirror);
  const setBlueprintMirror = useEditorStore((s) => s.setBlueprintMirror);
  const gridFocusMode = useEditorStore((s) => s.gridFocusMode);
  const setGridFocusMode = useEditorStore((s) => s.setGridFocusMode);
  const voiceControlEnabled = useEditorStore((s) => s.voiceControlEnabled);
  const setVoiceControlEnabled = useEditorStore((s) => s.setVoiceControlEnabled);
  const aiVoiceEnabled = useEditorStore((s) => s.aiVoiceEnabled);
  const betaAiVoice = useEditorStore((s) => s.betaFeatures.aiVoice);

  return (
    <div className="flex flex-col gap-1 p-2 bg-gray-50 border-r w-12 items-center select-none">
      {/* Shape tools flyout — at top */}
      <div className="relative">
        <button
          onClick={() => setShowShapeMenu(!showShapeMenu)}
          className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
            ${shapeTools.some((t) => t.id === currentTool) ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
          title="形状工具"
        >
          {shapeTools.find((t) => t.id === currentTool)?.icon || "📐"}
        </button>
        {showShapeMenu && (
          <div className="absolute left-full top-0 ml-1 bg-white border rounded shadow-lg flex flex-col gap-0.5 p-1 z-50">
            {shapeTools.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTool(t.id);
                  setShowShapeMenu(false);
                }}
                className={`w-20 h-8 rounded flex items-center gap-1.5 px-2 text-xs transition-colors
                  ${currentTool === t.id ? "bg-blue-500 text-white" : "hover:bg-gray-100"}`}
                title={`${t.label} (${t.shortcut})`}
              >
                <span className="text-sm">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Basic tools */}
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
      <button
        onClick={() => {
          // Find the canvas container to get its dimensions
          const container = document.querySelector("[data-canvas-container]");
          if (container) {
            fitToWindow(container.clientWidth, container.clientHeight);
          }
        }}
        className="w-9 h-7 rounded flex items-center justify-center text-[9px] hover:bg-gray-200"
        title="适应窗口"
      >
        ⊞
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

      {/* AI voice enhancement indicator (only when feature enabled + logged in) */}
      {blueprintMode && gridFocusMode && aiVoiceEnabled && betaAiVoice && hasToken() && (
        <div
          className="w-9 h-7 rounded flex items-center justify-center text-[9px] bg-green-500 text-white shadow"
          title="AI语音增强已启用"
        >
          AI
        </div>
      )}

    </div>
  );
}
