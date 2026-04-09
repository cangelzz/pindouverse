import { useEditorStore } from "../../store/editorStore";
import type { EditorTool } from "../../types";

const tools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "pen", label: "画笔", icon: "✏️", shortcut: "P" },
  { id: "eraser", label: "橡皮", icon: "🧹", shortcut: "E" },
  { id: "eyedropper", label: "取色", icon: "💧", shortcut: "I" },
  { id: "pan", label: "平移", icon: "✋", shortcut: "Space" },
];

export function CanvasToolbar() {
  const currentTool = useEditorStore((s) => s.currentTool);
  const setTool = useEditorStore((s) => s.setTool);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const blueprintMode = useEditorStore((s) => s.blueprintMode);
  const setBlueprintMode = useEditorStore((s) => s.setBlueprintMode);

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
    </div>
  );
}
