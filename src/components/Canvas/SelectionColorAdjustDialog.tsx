import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import { ColorAdjustPanel } from "../ColorAdjust/ColorAdjustPanel";
import { IDENTITY_ADJUSTMENTS, type ColorAdjustments } from "../../utils/colorAdjust";

interface Props {
  onClose: () => void;
}

export function SelectionColorAdjustDialog({ onClose }: Props) {
  const begin = useEditorStore((s) => s.beginSelectionAdjust);
  const update = useEditorStore((s) => s.updateSelectionAdjustPreview);
  const commit = useEditorStore((s) => s.commitSelectionAdjust);
  const cancel = useEditorStore((s) => s.cancelSelectionAdjust);

  const [adj, setAdj] = useState<ColorAdjustments>({ ...IDENTITY_ADJUSTMENTS });
  const [snapRange, setSnapRange] = useState<"all" | "used">("all");

  // Start the session once on mount.
  useEffect(() => {
    begin();
    return () => cancel(); // discard preview if unmounted without applying
  }, [begin, cancel]);

  // Debounced live preview whenever params or snap range change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update(adj, snapRange), 16);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [adj, snapRange, update]);

  const apply = () => {
    commit();
    onClose();
  };
  const close = () => {
    cancel();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={close}>
      <div
        className="bg-white rounded-lg shadow-xl p-4 w-72"
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="selection-adjust-dialog"
      >
        <h3 className="text-sm font-semibold mb-3">颜色调整</h3>
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
  );
}
