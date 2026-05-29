import { useMemo, useState } from "react";
import { MARD_COLORS } from "../../data/mard221";
import { getEffectiveHex, type ColorOverrideMap } from "../../utils/colorHelper";

interface Props {
  selectionColorCounts: Map<number, number>;
  currentDrawingColorIndex: number | null;
  colorOverrides: ColorOverrideMap;
  onConfirm: (fromIndex: number, toIndex: number) => void;
  onClose: () => void;
}

function Swatch({
  index,
  selected,
  count,
  overrides,
  onClick,
}: {
  index: number;
  selected: boolean;
  count?: number;
  overrides: ColorOverrideMap;
  onClick: () => void;
}) {
  const hex = getEffectiveHex(index, overrides) || "#cccccc";
  const code = MARD_COLORS[index]?.code ?? "?";
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center px-1 py-1 rounded ${
        selected ? "ring-2 ring-blue-500" : "hover:bg-gray-100"
      }`}
      title={code}
    >
      <span
        className="block w-6 h-6 border border-gray-300"
        style={{ backgroundColor: hex }}
      />
      {count !== undefined && (
        <span className="text-[9px] text-gray-500 mt-0.5">×{count}</span>
      )}
    </button>
  );
}

export function ReplaceColorInSelectionDialog({
  selectionColorCounts,
  currentDrawingColorIndex,
  colorOverrides,
  onConfirm,
  onClose,
}: Props) {
  const colors = useMemo(
    () =>
      [...selectionColorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([index, count]) => ({ index, count })),
    [selectionColorCounts]
  );
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);

  const canConfirm = from !== null && to !== null && from !== to;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[55]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-lg shadow-xl w-[420px] max-w-[90vw]">
        <div className="px-4 py-3 border-b text-sm font-semibold">替换选区内颜色</div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1">从（选区内）</div>
            <div className="flex flex-wrap gap-1">
              {colors.map((c) => (
                <Swatch
                  key={`from-${c.index}`}
                  index={c.index}
                  selected={from === c.index}
                  count={c.count}
                  overrides={colorOverrides}
                  onClick={() => setFrom(c.index)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">到</div>
            <div className="flex flex-wrap gap-1">
              {colors.map((c) => (
                <Swatch
                  key={`to-${c.index}`}
                  index={c.index}
                  selected={to === c.index}
                  overrides={colorOverrides}
                  onClick={() => setTo(c.index)}
                />
              ))}
              {currentDrawingColorIndex !== null && (
                <button
                  onClick={() => setTo(currentDrawingColorIndex)}
                  className={`flex flex-col items-center px-2 py-1 rounded border border-dashed ${
                    to === currentDrawingColorIndex
                      ? "ring-2 ring-blue-500 border-blue-500"
                      : "border-gray-300 hover:bg-gray-100"
                  }`}
                  title="使用当前画笔色"
                >
                  <span
                    className="block w-6 h-6 border border-gray-300"
                    style={{
                      backgroundColor:
                        getEffectiveHex(currentDrawingColorIndex, colorOverrides) || "#ccc",
                    }}
                  />
                  <span className="text-[9px] text-gray-500 mt-0.5">画笔色</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded border text-sm hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (canConfirm) {
                onConfirm(from!, to!);
                onClose();
              }
            }}
            disabled={!canConfirm}
            className={`px-3 py-1 rounded text-sm text-white ${
              canConfirm ? "bg-blue-500 hover:bg-blue-600" : "bg-blue-300 cursor-not-allowed"
            }`}
          >
            替换
          </button>
        </div>
      </div>
    </div>
  );
}
