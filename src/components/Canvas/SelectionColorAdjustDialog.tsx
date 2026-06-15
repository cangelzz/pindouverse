import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import { ColorAdjustPanel } from "../ColorAdjust/ColorAdjustPanel";
import { IDENTITY_ADJUSTMENTS, type ColorAdjustments } from "../../utils/colorAdjust";

interface Props {
  onClose: () => void;
}

const CARD_W = 288; // w-72

export function SelectionColorAdjustDialog({ onClose }: Props) {
  const begin = useEditorStore((s) => s.beginSelectionAdjust);
  const update = useEditorStore((s) => s.updateSelectionAdjustPreview);
  const commit = useEditorStore((s) => s.commitSelectionAdjust);
  const cancel = useEditorStore((s) => s.cancelSelectionAdjust);

  const [adj, setAdj] = useState<ColorAdjustments>({ ...IDENTITY_ADJUSTMENTS });
  const [snapRange, setSnapRange] = useState<"all" | "used">("all");

  const [pos, setPos] = useState(() => ({
    x: Math.max(8, Math.round(window.innerWidth / 2 - CARD_W / 2)),
    y: Math.max(8, Math.round(window.innerHeight * 0.18)),
  }));
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const onTitleDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const nx = dragStart.current.px + (e.clientX - dragStart.current.x);
      const ny = dragStart.current.py + (e.clientY - dragStart.current.y);
      setPos({
        x: Math.max(-CARD_W + 60, Math.min(window.innerWidth - 60, nx)),
        y: Math.max(0, Math.min(window.innerHeight - 36, ny)),
      });
    };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  useEffect(() => {
    begin();
    return () => cancel();
  }, [begin, cancel]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update(adj, snapRange), 16);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [adj, snapRange, update]);

  const apply = () => { commit(); onClose(); };
  const close = () => { cancel(); onClose(); };

  return (
    <div className="fixed inset-0 z-50" onMouseDown={close}>
      <div
        className="bg-white rounded-lg shadow-xl w-72 absolute"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="selection-adjust-dialog"
      >
        <h3
          className="text-sm font-semibold px-4 py-2 border-b cursor-move select-none"
          onMouseDown={onTitleDown}
        >
          颜色调整
        </h3>
        <div className="p-4">
          <ColorAdjustPanel value={adj} onChange={setAdj} />
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span className="text-gray-700">吸附范围</span>
            <button
              className={`px-2 py-0.5 rounded border ${snapRange === "all" ? "bg-blue-600 text-white" : ""}`}
              onClick={() => setSnapRange("all")}
            >
              全色板
            </button>
            <button
              className={`px-2 py-0.5 rounded border ${snapRange === "used" ? "bg-blue-600 text-white" : ""}`}
              onClick={() => setSnapRange("used")}
            >
              仅已用色
            </button>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="px-3 py-1 text-xs rounded border" onClick={close}>取消</button>
            <button className="px-3 py-1 text-xs rounded bg-blue-600 text-white" onClick={apply}>应用</button>
          </div>
        </div>
      </div>
    </div>
  );
}
