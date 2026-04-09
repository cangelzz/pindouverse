import { useState, useMemo, useEffect, useRef } from "react";
import { MARD_COLORS, COLOR_GROUPS, getGroupIndices } from "../../data/mard221";
import { useEditorStore } from "../../store/editorStore";

/** Get series prefix from color code */
function getSeriesPrefix(code: string): string {
  const m = code.match(/^([A-Z]+)/);
  return m ? m[1] : "";
}

/** Compute contrasting text color for a given background */
function textColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? "#000000" : "#FFFFFF";
}

export function ColorPalette() {
  const selectedColorIndex = useEditorStore((s) => s.selectedColorIndex);
  const setSelectedColor = useEditorStore((s) => s.setSelectedColor);
  const setTool = useEditorStore((s) => s.setTool);
  const highlightColorIndex = useEditorStore((s) => s.highlightColorIndex);
  const setHighlightColor = useEditorStore((s) => s.setHighlightColor);
  const countColor = useEditorStore((s) => s.countColor);
  const replaceColor = useEditorStore((s) => s.replaceColor);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("mard221");
  const [showReplace, setShowReplace] = useState(false);
  const [replaceTargetIndex, setReplaceTargetIndex] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected color in palette
  useEffect(() => {
    if (selectedColorIndex === null || !scrollContainerRef.current) return;
    const btn = scrollContainerRef.current.querySelector(`[data-color-index="${selectedColorIndex}"]`) as HTMLElement | null;
    if (btn) {
      btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedColorIndex]);

  const selectedCount = useMemo(() => {
    if (selectedColorIndex === null) return 0;
    return countColor(selectedColorIndex);
  }, [selectedColorIndex, countColor]);

  // Group filtered items by series
  const grouped = useMemo(() => {
    const groupIndices = new Set(getGroupIndices(groupId));
    let items = MARD_COLORS
      .map((c, i) => ({ color: c, index: i }))
      .filter(({ index }) => groupIndices.has(index));

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        ({ color: c }) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.hex.toLowerCase().includes(q)
      );
    }

    // Group by series prefix
    const map = new Map<string, { color: typeof MARD_COLORS[0]; index: number }[]>();
    for (const item of items) {
      const prefix = getSeriesPrefix(item.color.code);
      if (!map.has(prefix)) map.set(prefix, []);
      map.get(prefix)!.push(item);
    }
    return map;
  }, [search, groupId]);

  const totalCount = useMemo(() => {
    let n = 0;
    grouped.forEach((v) => (n += v.length));
    return n;
  }, [grouped]);

  return (
    <div className="flex flex-col h-full select-none">
      <div className="px-2 py-1.5 border-b bg-gray-50">
        <div className="flex items-center gap-1 mb-1">
          <h3 className="text-xs font-semibold text-gray-600">色板</h3>
          <span className="text-[10px] text-gray-400">({totalCount})</span>
        </div>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full px-1 py-0.5 text-xs border rounded mb-1"
        >
          {COLOR_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="搜索色号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1" ref={scrollContainerRef}>
        {Array.from(grouped.entries()).map(([prefix, items], gi) => (
          <div key={prefix}>
            {gi > 0 && (
              <div className="flex items-center gap-1 my-1">
                <div className="flex-1 border-t border-gray-300" />
                <span className="text-[9px] text-gray-400 font-semibold">{prefix}</span>
                <div className="flex-1 border-t border-gray-300" />
              </div>
            )}
            {gi === 0 && (
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] text-gray-400 font-semibold">{prefix}</span>
                <div className="flex-1 border-t border-gray-300" />
              </div>
            )}
            <div className="flex flex-wrap gap-0.5">
              {items.map(({ color, index }) => {
                const isSelected = selectedColorIndex === index;
                return (
                  <button
                    key={color.code}
                    data-color-index={index}
                    onClick={() => {
                      setSelectedColor(index);
                      setTool("pen");
                    }}
                    className={`flex items-center justify-center rounded-sm border transition-all
                      ${isSelected ? "ring-2 ring-blue-500 ring-offset-1 z-10" : "border-gray-200 hover:border-gray-400"}`}
                    style={{
                      backgroundColor: color.hex || "#FFF",
                      color: textColor(color.hex || "#FFF"),
                      width: 36,
                      height: 28,
                      fontSize: 8,
                      fontWeight: 600,
                      lineHeight: 1,
                    }}
                    title={`${color.code}\n${color.hex}\nRGB(${color.rgb?.join(", ")})`}
                  >
                    {color.code}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selected color info & actions */}
      {selectedColorIndex !== null && (
        <div className="px-2 py-1.5 border-t bg-gray-50 text-xs">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded border border-gray-300 shrink-0"
              style={{ backgroundColor: MARD_COLORS[selectedColorIndex]?.hex }}
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{MARD_COLORS[selectedColorIndex]?.code}</div>
              <div className="text-gray-400 truncate">{MARD_COLORS[selectedColorIndex]?.hex}</div>
            </div>
            <span className="text-gray-500 shrink-0">{selectedCount} 颗</span>
          </div>
          <div className="flex gap-1 mt-1.5">
            <button
              onClick={() => {
                if (highlightColorIndex === selectedColorIndex) {
                  setHighlightColor(null);
                } else {
                  setHighlightColor(selectedColorIndex);
                }
              }}
              className={`flex-1 px-1 py-0.5 rounded text-[10px] border ${
                highlightColorIndex === selectedColorIndex
                  ? "bg-red-100 border-red-400 text-red-700"
                  : "hover:bg-gray-100 border-gray-300"
              }`}
            >
              {highlightColorIndex === selectedColorIndex ? "取消高亮" : "高亮"}
            </button>
            <button
              onClick={() => { setShowReplace(!showReplace); setReplaceTargetIndex(null); }}
              className={`flex-1 px-1 py-0.5 rounded text-[10px] border ${
                showReplace
                  ? "bg-blue-100 border-blue-400 text-blue-700"
                  : "hover:bg-gray-100 border-gray-300"
              }`}
            >
              替换颜色
            </button>
          </div>

          {/* Replace color picker */}
          {showReplace && (
            <div className="mt-1.5 border rounded p-1.5 bg-white">
              <p className="text-[10px] text-gray-500 mb-1">
                将画布中所有 {MARD_COLORS[selectedColorIndex]?.code} 替换为:
              </p>
              <div className="flex flex-wrap gap-0.5 max-h-20 overflow-y-auto">
                {MARD_COLORS.map((c, i) => {
                  if (i === selectedColorIndex) return null;
                  return (
                    <button
                      key={c.code}
                      onClick={() => setReplaceTargetIndex(i)}
                      className={`w-5 h-5 rounded-sm border ${
                        replaceTargetIndex === i
                          ? "ring-2 ring-blue-500"
                          : "border-gray-200 hover:border-gray-400"
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.code}
                    />
                  );
                })}
              </div>
              {replaceTargetIndex !== null && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[10px] text-gray-600">
                    → {MARD_COLORS[replaceTargetIndex]?.code}
                  </span>
                  <button
                    onClick={() => {
                      replaceColor(selectedColorIndex, replaceTargetIndex);
                      setShowReplace(false);
                      setReplaceTargetIndex(null);
                    }}
                    className="px-2 py-0.5 bg-blue-500 text-white text-[10px] rounded hover:bg-blue-600"
                  >
                    确认替换
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
