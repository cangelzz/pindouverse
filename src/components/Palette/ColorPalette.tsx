import { useState, useMemo, useEffect, useRef } from "react";
import { MARD_COLORS, COLOR_GROUPS, getGroupIndices, groupIndicesByLetter } from "../../data/mard221";
import { useEditorStore } from "../../store/editorStore";
import { getEffectiveHex } from "../../utils/colorHelper";

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
  const customColorGroups = useEditorStore((s) => s.customColorGroups);
  const addCustomColorGroup = useEditorStore((s) => s.addCustomColorGroup);
  const removeCustomColorGroup = useEditorStore((s) => s.removeCustomColorGroup);
  const toggleColorInGroup = useEditorStore((s) => s.toggleColorInGroup);
  const reorderCustomGroupColors = useEditorStore((s) => s.reorderCustomGroupColors);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);
  const setColorOverride = useEditorStore((s) => s.setColorOverride);
  const removeColorOverride = useEditorStore((s) => s.removeColorOverride);
  const clearColorOverrides = useEditorStore((s) => s.clearColorOverrides);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("mard221");
  const [showReplace, setShowReplace] = useState(false);
  const [replaceTargetIndex, setReplaceTargetIndex] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [editOverrideIndex, setEditOverrideIndex] = useState<number | null>(null);
  const [editOverrideHex, setEditOverrideHex] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; colorIndex: number } | null>(null);

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

  // Check if current group is a custom group
  const isCustomGroup = groupId.startsWith("custom_");
  const isOverridesGroup = groupId === "__overrides__";
  const currentCustomGroup = customColorGroups.find((g) => g.id === groupId);

  // Group filtered items by series
  const grouped = useMemo(() => {
    let items: { color: typeof MARD_COLORS[0]; index: number }[];

    if (isOverridesGroup) {
      items = [...colorOverrides.keys()].map((i) => ({ color: MARD_COLORS[i], index: i }));
    } else if (isCustomGroup && currentCustomGroup) {
      // Custom group: use explicit color indices
      const indexSet = new Set(currentCustomGroup.colorIndices);
      items = MARD_COLORS
        .map((c, i) => ({ color: c, index: i }))
        .filter(({ index }) => indexSet.has(index));
    } else {
      const groupIndices = new Set(getGroupIndices(groupId));
      items = MARD_COLORS
        .map((c, i) => ({ color: c, index: i }))
        .filter(({ index }) => groupIndices.has(index));
    }

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
  }, [search, groupId, isCustomGroup, isOverridesGroup, currentCustomGroup, colorOverrides]);

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
        <div className="flex items-center gap-1 mb-1">
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="flex-1 px-1 py-0.5 text-xs border rounded"
          >
            {COLOR_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
            {customColorGroups.length > 0 && (
              <option disabled>──── 自定义 ────</option>
            )}
            {customColorGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.colorIndices.length})</option>
            ))}
            {colorOverrides.size > 0 && (
              <>
                <option disabled>──── 调整 ────</option>
                <option value="__overrides__">已调整颜色 ({colorOverrides.size})</option>
              </>
            )}
          </select>
          <button
            onClick={() => {
              const name = prompt("输入自定义色组名称：", "我的色组");
              if (name) {
                addCustomColorGroup(name);
              }
            }}
            className="w-6 h-6 flex items-center justify-center rounded border hover:bg-gray-100 text-xs shrink-0"
            title="新建自定义色组"
          >
            +
          </button>
          {isOverridesGroup && (
            <button
              onClick={() => {
                if (confirm("确定还原所有已调整的颜色？")) {
                  clearColorOverrides();
                  setGroupId("mard221");
                }
              }}
              className="w-6 h-6 flex items-center justify-center rounded border hover:bg-red-100 text-red-500 text-xs shrink-0"
              title="还原所有调整"
            >
              ↩
            </button>
          )}
          {isCustomGroup && (
            <button
              onClick={() => {
                if (confirm(`确定删除色组「${currentCustomGroup?.name}」？`)) {
                  removeCustomColorGroup(groupId);
                  setGroupId("mard221");
                }
              }}
              className="w-6 h-6 flex items-center justify-center rounded border hover:bg-red-100 text-red-500 text-xs shrink-0"
              title="删除当前自定义色组"
            >
              ×
            </button>
          )}
          {isCustomGroup && currentCustomGroup && currentCustomGroup.colorIndices.length > 1 && (
            <button
              onClick={() => {
                // Sort by frequency (most used first)
                const sorted = [...currentCustomGroup.colorIndices].sort((a, b) => {
                  return countColor(b) - countColor(a);
                });
                reorderCustomGroupColors(groupId, sorted);
              }}
              className="w-6 h-6 flex items-center justify-center rounded border hover:bg-gray-100 text-xs shrink-0"
              title="按使用频率排序（最多的在前）"
            >
              ↕
            </button>
          )}
        </div>
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
                    draggable={isCustomGroup}
                    onDragStart={() => { if (isCustomGroup) dragItem.current = index; }}
                    onDragOver={(e) => { if (isCustomGroup) { e.preventDefault(); dragOverItem.current = index; } }}
                    onDrop={() => {
                      if (!isCustomGroup || !currentCustomGroup || dragItem.current === null || dragOverItem.current === null) return;
                      if (dragItem.current === dragOverItem.current) return;
                      const list = [...currentCustomGroup.colorIndices];
                      const fromIdx = list.indexOf(dragItem.current);
                      const toIdx = list.indexOf(dragOverItem.current);
                      if (fromIdx === -1 || toIdx === -1) return;
                      list.splice(fromIdx, 1);
                      list.splice(toIdx, 0, dragItem.current);
                      reorderCustomGroupColors(groupId, list);
                      dragItem.current = null;
                      dragOverItem.current = null;
                    }}
                    onClick={() => {
                      setSelectedColor(index);
                      setTool("pen");
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, colorIndex: index });
                    }}
                    className={`relative flex items-center justify-center rounded-sm border transition-all
                      ${isSelected ? "ring-2 ring-blue-500 ring-offset-1 z-10" : "border-gray-200 hover:border-gray-400"}`}
                    style={{
                      backgroundColor: getEffectiveHex(index, colorOverrides),
                      color: textColor(getEffectiveHex(index, colorOverrides)),
                      width: 36,
                      height: 28,
                      fontSize: 8,
                      fontWeight: 600,
                      lineHeight: 1,
                    }}
                    title={`${color.code}\n${getEffectiveHex(index, colorOverrides)}\nRGB(${color.rgb?.join(", ")})${colorOverrides.has(index) ? "\n(已调整)" : ""}`}
                  >
                    {color.code}
                    {colorOverrides.has(index) && (
                      <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-orange-400 rounded-full" />
                    )}
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
              style={{ backgroundColor: getEffectiveHex(selectedColorIndex, colorOverrides) }}
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{MARD_COLORS[selectedColorIndex]?.code}</div>
              <div className="text-gray-400 truncate">{getEffectiveHex(selectedColorIndex, colorOverrides)}</div>
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
              onClick={() => { setShowReplace(!showReplace); setReplaceTargetIndex(null); if (showReplace) setHighlightColor(null); }}
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
                将画布中所有 {MARD_COLORS[selectedColorIndex]?.code} ({selectedCount} 颗) ��换为:
              </p>
              <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                {groupIndicesByLetter(MARD_COLORS.map((_, i) => i)).map(({ letter, indices }) => (
                  <div key={letter} className="flex items-start gap-1">
                    <span className="text-[9px] text-gray-500 font-mono w-3 shrink-0 pt-0.5 text-center">{letter}</span>
                    <div className="flex flex-wrap gap-0.5 flex-1">
                      {indices.map((i) => {
                        if (i === selectedColorIndex) return null;
                        const c = MARD_COLORS[i];
                        return (
                          <button
                            key={c.code}
                            onClick={() => {
                              setReplaceTargetIndex(i);
                              setHighlightColor(selectedColorIndex);
                            }}
                            className={`w-5 h-5 rounded-sm border ${
                              replaceTargetIndex === i
                                ? "ring-2 ring-blue-500"
                                : "border-gray-200 hover:border-gray-400"
                            }`}
                            style={{ backgroundColor: getEffectiveHex(i, colorOverrides) }}
                            title={c.code}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {replaceTargetIndex !== null && (
                <div className="mt-1.5 p-1.5 bg-gray-50 rounded border">
                  {/* Preview: before → after */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex items-center gap-1">
                      <div className="w-6 h-6 rounded border" style={{ backgroundColor: getEffectiveHex(selectedColorIndex, colorOverrides) }} />
                      <span className="text-[10px] font-medium">{MARD_COLORS[selectedColorIndex]?.code}</span>
                    </div>
                    <span className="text-gray-400 text-xs">→</span>
                    <div className="flex items-center gap-1">
                      <div className="w-6 h-6 rounded border" style={{ backgroundColor: getEffectiveHex(replaceTargetIndex, colorOverrides) }} />
                      <span className="text-[10px] font-medium">{MARD_COLORS[replaceTargetIndex]?.code}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 ml-auto">{selectedCount} 颗</span>
                  </div>
                  <p className="text-[9px] text-gray-400 mb-1">画布中已高亮显示将被替换的格子</p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        replaceColor(selectedColorIndex, replaceTargetIndex);
                        setShowReplace(false);
                        setReplaceTargetIndex(null);
                        setHighlightColor(null);
                      }}
                      className="flex-1 px-2 py-1 bg-blue-500 text-white text-[10px] rounded hover:bg-blue-600"
                    >
                      确认替换
                    </button>
                    <button
                      onClick={() => {
                        setReplaceTargetIndex(null);
                        setHighlightColor(null);
                      }}
                      className="px-2 py-1 text-[10px] rounded border hover:bg-gray-100"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div
            className="fixed z-50 bg-white rounded-lg shadow-lg border py-1 min-w-[140px] text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                const ci = contextMenu.colorIndex;
                const current = colorOverrides.get(ci)?.hex || MARD_COLORS[ci]?.hex || "#FFFFFF";
                setEditOverrideIndex(ci);
                setEditOverrideHex(current);
                setContextMenu(null);
              }}
            >
              🎨 调整颜色
            </button>
            {colorOverrides.has(contextMenu.colorIndex) && (
              <button
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2"
                onClick={() => {
                  removeColorOverride(contextMenu.colorIndex);
                  setContextMenu(null);
                }}
              >
                ↩ 还原颜色
              </button>
            )}
            {isCustomGroup && currentCustomGroup && (
              <button
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2 border-t"
                onClick={() => {
                  toggleColorInGroup(groupId, contextMenu.colorIndex);
                  setContextMenu(null);
                }}
              >
                ✕ 从色组移除
              </button>
            )}
            {!isCustomGroup && customColorGroups.length === 1 && (
              <button
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2 border-t"
                onClick={() => {
                  toggleColorInGroup(customColorGroups[0].id, contextMenu.colorIndex);
                  setContextMenu(null);
                }}
              >
                ＋ 添加到 {customColorGroups[0].name}
              </button>
            )}
            {!isCustomGroup && customColorGroups.length > 1 && (
              customColorGroups.map((g) => (
                <button
                  key={g.id}
                  className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2 first:border-t"
                  onClick={() => {
                    toggleColorInGroup(g.id, contextMenu.colorIndex);
                    setContextMenu(null);
                  }}
                >
                  ＋ {g.name}
                </button>
              ))
            )}
          </div>
        </>
      )}

      {/* Color override edit dialog */}
      {editOverrideIndex !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[280px] p-4">
            <h3 className="text-sm font-semibold mb-3">调整颜色 — {MARD_COLORS[editOverrideIndex]?.code}</h3>
            <div className="flex items-center gap-3 mb-3">
              <div>
                <div className="text-[10px] text-gray-400 mb-1">原始</div>
                <div
                  className="w-10 h-10 rounded border"
                  style={{ backgroundColor: MARD_COLORS[editOverrideIndex]?.hex }}
                />
              </div>
              <span className="text-gray-400">→</span>
              <div>
                <div className="text-[10px] text-gray-400 mb-1">调整后</div>
                <div
                  className="w-10 h-10 rounded border"
                  style={{ backgroundColor: editOverrideHex }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="color"
                value={editOverrideHex}
                onChange={(e) => setEditOverrideHex(e.target.value)}
                className="w-8 h-8 cursor-pointer"
              />
              <input
                type="text"
                value={editOverrideHex}
                onChange={(e) => setEditOverrideHex(e.target.value)}
                className="flex-1 px-2 py-1 border rounded text-sm font-mono"
                placeholder="#RRGGBB"
              />
            </div>
            <div className="flex justify-end gap-2">
              {colorOverrides.has(editOverrideIndex) && (
                <button
                  onClick={() => {
                    removeColorOverride(editOverrideIndex);
                    setEditOverrideIndex(null);
                  }}
                  className="px-3 py-1 text-xs text-red-500 border rounded hover:bg-red-50"
                >
                  还原
                </button>
              )}
              <button
                onClick={() => setEditOverrideIndex(null)}
                className="px-3 py-1 text-xs border rounded hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (/^#[0-9a-fA-F]{6}$/.test(editOverrideHex)) {
                    setColorOverride(editOverrideIndex, editOverrideHex);
                    setEditOverrideIndex(null);
                  }
                }}
                className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
