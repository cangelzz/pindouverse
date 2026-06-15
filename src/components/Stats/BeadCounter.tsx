import { useMemo, useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { MARD_COLORS } from "../../data/mard221";
import { getEffectiveColor } from "../../utils/colorHelper";
import type { BeadCount } from "../../types";

type SortMode = "count" | "code";

export function BeadCounter({ onColorActivate }: { onColorActivate?: (colorIndex: number) => void }) {
  const canvasData = useEditorStore((s) => s.canvasData);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);
  const [sortMode, setSortMode] = useState<SortMode>("count");

  const counts = useMemo<BeadCount[]>(() => {
    const map = new Map<number, number>();
    for (const row of canvasData) {
      for (const cell of row) {
        if (cell.colorIndex !== null) {
          map.set(cell.colorIndex, (map.get(cell.colorIndex) ?? 0) + 1);
        }
      }
    }

    const result: BeadCount[] = [];
    for (const [idx, count] of map) {
      const base = MARD_COLORS[idx];
      if (base) {
        const c = getEffectiveColor(idx, colorOverrides);
        result.push({
          colorIndex: idx,
          code: base.code,
          name: base.name,
          hex: c.hex,
          count,
        });
      }
    }

    if (sortMode === "count") {
      result.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
    } else {
      result.sort((a, b) => a.code.localeCompare(b.code));
    }
    return result;
  }, [canvasData, sortMode, colorOverrides]);

  const totalBeads = counts.reduce((sum, c) => sum + c.count, 0);
  const totalColors = counts.length;

  return (
    <div className="flex flex-col h-full select-none">
      <div className="px-2 py-1.5 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-600">用量统计</h3>
          <div className="flex gap-0.5">
            <button
              onClick={() => setSortMode("count")}
              className={`px-1.5 py-0.5 text-[10px] rounded border ${
                sortMode === "count"
                  ? "bg-blue-100 border-blue-400 text-blue-700"
                  : "border-gray-300 hover:bg-gray-100"
              }`}
            >
              按数量
            </button>
            <button
              onClick={() => setSortMode("code")}
              className={`px-1.5 py-0.5 text-[10px] rounded border ${
                sortMode === "code"
                  ? "bg-blue-100 border-blue-400 text-blue-700"
                  : "border-gray-300 hover:bg-gray-100"
              }`}
            >
              按色号
            </button>
          </div>
        </div>
        <p className="text-[10px] text-gray-400">
          {totalColors} 种颜色 · {totalBeads} 颗拼豆
          {counts.length > 0 && (
            <button
              onClick={() => {
                const header = "色号,名称,HEX,数量\n";
                const rows = counts.map((c) => `${c.code},${c.name},${c.hex},${c.count}`).join("\n");
                const csv = "\uFEFF" + header + rows; // BOM for Excel Chinese support
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "pindou_shopping_list.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="ml-2 text-blue-500 hover:text-blue-700 underline"
            >
              导出CSV
            </button>
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {counts.length === 0 ? (
          <p className="text-xs text-gray-400 p-3 text-center">画布为空</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b">
                <th className="px-2 py-1 text-left">颜色</th>
                <th className="px-2 py-1 text-left">色号</th>
                <th className="px-2 py-1 text-right">数量</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => (
                <tr
                  key={c.code}
                  data-bead-row={c.colorIndex}
                  onDoubleClick={() => onColorActivate?.(c.colorIndex)}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  title="双击：在色板中选中并高亮分布"
                >
                  <td className="px-2 py-0.5">
                    <div className="flex items-center gap-1">
                      <span
                        className="inline-block w-3 h-3 rounded-sm border border-gray-200"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="text-gray-600 truncate max-w-[60px]">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-0.5 text-gray-500">{c.code}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
