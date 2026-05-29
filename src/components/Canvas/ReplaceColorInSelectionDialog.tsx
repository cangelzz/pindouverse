import { useMemo, useState } from "react";
import { MARD_COLORS, groupIndicesByLetter, getGroupIndices } from "../../data/mard221";
import { getEffectiveHex, type ColorOverrideMap } from "../../utils/colorHelper";

interface ReplaceRule {
  from: number | null;
  to: number | null;
}

interface Props {
  selectionColorCounts: Map<number, number>;
  colorOverrides: ColorOverrideMap;
  /** Receives only rules where both from/to are picked and from!==to. */
  onConfirm: (rules: { from: number; to: number }[]) => void;
  onClose: () => void;
}

/** Contrasting text color for a hex background (matches main palette). */
function textColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? "#000000" : "#FFFFFF";
}

/** Color swatch matching the main palette visual: 36×28 with code text inside. */
function CodeSwatch({
  index,
  selected,
  overrides,
  onClick,
}: {
  index: number;
  selected: boolean;
  overrides: ColorOverrideMap;
  onClick: () => void;
}) {
  const hex = getEffectiveHex(index, overrides) || "#cccccc";
  const code = MARD_COLORS[index]?.code ?? "?";
  return (
    <button
      onClick={onClick}
      className={`relative rounded border flex items-center justify-center transition ${
        selected ? "border-blue-500 ring-2 ring-blue-300" : "border-gray-300 hover:border-gray-500"
      }`}
      style={{
        backgroundColor: hex,
        color: textColor(hex),
        width: 36,
        height: 28,
        fontSize: 8,
        fontWeight: 600,
        lineHeight: 1,
      }}
      title={`${code}\n${hex}`}
    >
      {code}
    </button>
  );
}

/** Empty placeholder slot — same footprint as a CodeSwatch. */
function EmptySlot({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center rounded border-2 border-dashed text-[10px] hover:bg-gray-50 ${
        active ? "border-blue-400 bg-blue-50 text-blue-600" : "border-gray-300 text-gray-400"
      }`}
      style={{ width: 36, height: 28 }}
    >
      {label}
    </button>
  );
}

export function ReplaceColorInSelectionDialog({
  selectionColorCounts,
  colorOverrides,
  onConfirm,
  onClose,
}: Props) {
  const [rules, setRules] = useState<ReplaceRule[]>([]);
  const [picking, setPicking] = useState<{ ruleIndex: number; side: "from" | "to" } | null>(null);

  const selectionColors = useMemo(
    () =>
      [...selectionColorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([index, count]) => ({ index, count })),
    [selectionColorCounts]
  );

  // Full MARD palette, grouped by series letter prefix (M, G, B, …) so the
  // target picker reads the same way as the main palette grid.
  const allIndices = useMemo(() => getGroupIndices("mard221"), []);
  const letterGroups = useMemo(() => groupIndicesByLetter(allIndices), [allIndices]);

  const validRules = rules.filter(
    (r): r is { from: number; to: number } =>
      r.from !== null && r.to !== null && r.from !== r.to,
  );
  const canConfirm = validRules.length > 0;

  const addRule = () => {
    setRules((r) => [...r, { from: null, to: null }]);
    // Auto-open the from-picker for the new rule so the user can start picking.
    setPicking({ ruleIndex: rules.length, side: "from" });
  };

  const removeRule = (i: number) => {
    setRules((r) => r.filter((_, idx) => idx !== i));
    if (picking?.ruleIndex === i) setPicking(null);
  };

  const pickValue = (i: number, side: "from" | "to", value: number) => {
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, [side]: value } : rule)));
    // After picking from, auto-advance to the to-picker for convenience.
    if (side === "from") {
      const rule = rules[i];
      if (rule.to === null) {
        setPicking({ ruleIndex: i, side: "to" });
        return;
      }
    }
    setPicking(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[55]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b text-sm font-semibold">替换选区内颜色</div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {rules.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-4">
              暂无替换规则。点下方「+ 添加替换规则」开始。
            </div>
          )}

          {rules.map((rule, i) => {
            const isPickingFrom = picking?.ruleIndex === i && picking?.side === "from";
            const isPickingTo = picking?.ruleIndex === i && picking?.side === "to";
            return (
              <div key={i} className="flex flex-col gap-2 border border-gray-200 rounded p-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-8 shrink-0">原色</span>
                  {rule.from !== null ? (
                    <CodeSwatch
                      index={rule.from}
                      selected={isPickingFrom}
                      overrides={colorOverrides}
                      onClick={() =>
                        setPicking(isPickingFrom ? null : { ruleIndex: i, side: "from" })
                      }
                    />
                  ) : (
                    <EmptySlot
                      active={isPickingFrom}
                      onClick={() =>
                        setPicking(isPickingFrom ? null : { ruleIndex: i, side: "from" })
                      }
                      label="选"
                    />
                  )}
                  <span className="text-gray-400">→</span>
                  <span className="text-[10px] text-gray-500 w-8 shrink-0">目标</span>
                  {rule.to !== null ? (
                    <CodeSwatch
                      index={rule.to}
                      selected={isPickingTo}
                      overrides={colorOverrides}
                      onClick={() =>
                        setPicking(isPickingTo ? null : { ruleIndex: i, side: "to" })
                      }
                    />
                  ) : (
                    <EmptySlot
                      active={isPickingTo}
                      onClick={() =>
                        setPicking(isPickingTo ? null : { ruleIndex: i, side: "to" })
                      }
                      label="选"
                    />
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => removeRule(i)}
                    className="px-1.5 py-0.5 text-xs text-red-500 border border-red-300 rounded hover:bg-red-50"
                    title="删除此规则"
                  >
                    ×
                  </button>
                </div>

                {/* Inline picker — only one row at a time can be in pick mode. */}
                {isPickingFrom && (
                  <div
                    data-testid="replace-from-picker"
                    className="border border-blue-200 rounded p-2 bg-blue-50/40"
                  >
                    <div className="text-[10px] text-gray-500 mb-1">
                      选区内颜色（{selectionColors.length}）
                    </div>
                    {selectionColors.length === 0 ? (
                      <div className="text-[10px] text-gray-400 py-2 text-center">
                        选区内没有任何颜色
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {selectionColors.map((c) => (
                          <div key={c.index} className="flex flex-col items-center">
                            <CodeSwatch
                              index={c.index}
                              selected={rule.from === c.index}
                              overrides={colorOverrides}
                              onClick={() => pickValue(i, "from", c.index)}
                            />
                            <span className="text-[9px] text-gray-500 mt-0.5">×{c.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {isPickingTo && (
                  <div
                    data-testid="replace-to-picker"
                    className="border border-blue-200 rounded p-2 bg-blue-50/40 max-h-60 overflow-y-auto"
                  >
                    {letterGroups.map(({ letter, indices }) => (
                      <div key={letter} className="mb-1.5">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-[9px] text-gray-400 font-semibold">{letter}</span>
                          <div className="flex-1 border-t border-gray-300" />
                        </div>
                        <div className="flex flex-wrap gap-0.5">
                          {indices.map((idx) => (
                            <CodeSwatch
                              key={idx}
                              index={idx}
                              selected={rule.to === idx}
                              overrides={colorOverrides}
                              onClick={() => pickValue(i, "to", idx)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={addRule}
            className="self-start px-3 py-1.5 text-xs border border-dashed border-blue-400 text-blue-600 rounded hover:bg-blue-50"
          >
            + 添加替换规则
          </button>
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
                onConfirm(validRules);
                onClose();
              }
            }}
            disabled={!canConfirm}
            className={`px-3 py-1 rounded text-sm text-white ${
              canConfirm ? "bg-blue-500 hover:bg-blue-600" : "bg-blue-300 cursor-not-allowed"
            }`}
          >
            执行替换{validRules.length > 0 ? ` (${validRules.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
