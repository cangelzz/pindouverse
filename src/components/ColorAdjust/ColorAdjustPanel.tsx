import type { ColorAdjustments } from "../../utils/colorAdjust";
import { IDENTITY_ADJUSTMENTS, isIdentity } from "../../utils/colorAdjust";

interface SliderDef {
  key: keyof ColorAdjustments;
  label: string;
}

const SLIDERS: SliderDef[] = [
  { key: "exposure", label: "曝光" },
  { key: "contrast", label: "对比度" },
  { key: "saturation", label: "饱和度" },
  { key: "vibrance", label: "鲜艳度" },
  { key: "temperature", label: "色温" },
  { key: "tint", label: "色调" },
];

interface ColorAdjustPanelProps {
  value: ColorAdjustments;
  onChange: (next: ColorAdjustments) => void;
}

export function ColorAdjustPanel({ value, onChange }: ColorAdjustPanelProps) {
  const setKey = (key: keyof ColorAdjustments, v: number) => {
    onChange({ ...value, [key]: Math.max(-100, Math.min(100, Math.round(v))) });
  };

  return (
    <div className="space-y-2" data-testid="color-adjust-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{isIdentity(value) ? "无调整" : "已调整"}</span>
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline disabled:text-gray-300"
          disabled={isIdentity(value)}
          onClick={() => onChange({ ...IDENTITY_ADJUSTMENTS })}
        >
          全部重置
        </button>
      </div>
      {SLIDERS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2">
          <label className="w-12 text-xs text-gray-700">{label}</label>
          <input
            type="range"
            min={-100}
            max={100}
            value={value[key]}
            onChange={(e) => setKey(key, Number(e.target.value))}
            onDoubleClick={() => setKey(key, 0)}
            className="flex-1"
            aria-label={label}
          />
          <input
            type="number"
            min={-100}
            max={100}
            value={value[key]}
            onChange={(e) => setKey(key, Number(e.target.value))}
            className="w-12 text-xs border rounded px-1 py-0.5"
            aria-label={`${label}数值`}
          />
        </div>
      ))}
    </div>
  );
}
