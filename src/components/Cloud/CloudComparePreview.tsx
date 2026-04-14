import { useRef, useEffect } from "react";
import { MARD_COLORS } from "../../data/mard221";
import type { CanvasData } from "../../types";

interface ComparePreviewProps {
  localData: CanvasData;
  localSize: { width: number; height: number };
  localTimestamp: string;
  cloudData: CanvasData;
  cloudSize: { width: number; height: number };
  cloudTimestamp: string;
  onChooseLocal: () => void;
  onChooseCloud: () => void;
  onCancel: () => void;
}

function renderPreview(
  canvas: HTMLCanvasElement,
  data: CanvasData,
  width: number,
  height: number,
  maxSize: number,
) {
  const aspect = width / height;
  const w = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
  const h = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const sx = w / width;
  const sy = h / height;

  ctx.fillStyle = "#e5e5e5";
  ctx.fillRect(0, 0, w, h);
  const checkSize = 4;
  ctx.fillStyle = "#d0d0d0";
  for (let r = 0; r < h; r += checkSize) {
    for (let c = 0; c < w; c += checkSize) {
      if ((Math.floor(r / checkSize) + Math.floor(c / checkSize)) % 2 === 0) {
        ctx.fillRect(c, r, checkSize, checkSize);
      }
    }
  }

  for (let r = 0; r < height && r < data.length; r++) {
    for (let c = 0; c < width && c < data[r].length; c++) {
      const cell = data[r][c];
      if (cell.colorIndex !== null) {
        const color = MARD_COLORS[cell.colorIndex];
        ctx.fillStyle = color?.hex || "#FF00FF";
        ctx.fillRect(
          Math.floor(c * sx),
          Math.floor(r * sy),
          Math.ceil(sx),
          Math.ceil(sy),
        );
      }
    }
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function CloudComparePreview(props: ComparePreviewProps) {
  const localRef = useRef<HTMLCanvasElement>(null);
  const cloudRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (localRef.current) {
      renderPreview(localRef.current, props.localData, props.localSize.width, props.localSize.height, 200);
    }
  }, [props.localData, props.localSize]);

  useEffect(() => {
    if (cloudRef.current) {
      renderPreview(cloudRef.current, props.cloudData, props.cloudSize.width, props.cloudSize.height, 200);
    }
  }, [props.cloudData, props.cloudSize]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl w-[520px] p-4">
        <h2 className="font-semibold text-sm mb-1">云端版本已更新</h2>
        <p className="text-xs text-gray-500 mb-3">云端版本比本地更新，请选择保留哪个版本。</p>

        <div className="flex gap-4 justify-center mb-4">
          <div className="flex flex-col items-center">
            <div className="text-xs font-semibold text-blue-600 mb-1">本地���本</div>
            <canvas
              ref={localRef}
              className="border border-gray-300 rounded"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="text-[10px] text-gray-400 mt-1">
              {props.localSize.width}×{props.localSize.height} · {formatTime(props.localTimestamp)}
            </div>
          </div>

          <div className="flex flex-col items-center">
            <div className="text-xs font-semibold text-green-600 mb-1">云端版本</div>
            <canvas
              ref={cloudRef}
              className="border border-gray-300 rounded"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="text-[10px] text-gray-400 mt-1">
              {props.cloudSize.width}×{props.cloudSize.height} · {formatTime(props.cloudTimestamp)}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-center">
          <button
            onClick={props.onChooseLocal}
            className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
          >
            覆盖云端
          </button>
          <button
            onClick={props.onChooseCloud}
            className="px-3 py-1.5 text-xs rounded bg-green-500 text-white hover:bg-green-600"
          >
            下载云端
          </button>
          <button
            onClick={props.onCancel}
            className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
