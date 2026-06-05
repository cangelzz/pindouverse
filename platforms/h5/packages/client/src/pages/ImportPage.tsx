import { useState, useRef, useCallback } from 'react';
import type { ColorMatchAlgorithm, CanvasData } from '@pindou/core';
import { matchImageToMard, MARD_COLORS } from '@pindou/core';

interface Props {
  onResult: (data: CanvasData, width: number, height: number) => void;
  onBack: () => void;
}

const PRESETS = [26, 52, 78, 104];

export default function ImportPage({ onResult, onBack }: Props) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [maxDim, setMaxDim] = useState(52);
  const [algorithm, setAlgorithm] = useState<ColorMatchAlgorithm>('euclidean');
  const [resizeMode, setResizeMode] = useState<'sharp' | 'smooth'>('smooth');
  const [widthRatio, setWidthRatio] = useState(1.0);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<{ data: CanvasData; w: number; h: number } | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    setPreview(null);
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
  };

  const generate = useCallback(async () => {
    if (!imageSrc) return;
    setProcessing(true);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = imageSrc; });

      const aspect = (img.naturalWidth * widthRatio) / img.naturalHeight;
      let tw: number, th: number;
      if (aspect >= 1) {
        tw = Math.min(maxDim, Math.round(maxDim * widthRatio));
        th = Math.round(tw / aspect);
      } else {
        th = maxDim;
        tw = Math.round(th * aspect);
      }
      tw = Math.max(1, tw);
      th = Math.max(1, th);

      const offscreen = document.createElement('canvas');
      offscreen.width = tw;
      offscreen.height = th;
      const ctx = offscreen.getContext('2d')!;
      ctx.imageSmoothingEnabled = resizeMode === 'smooth';
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, tw, th);

      const imageData = ctx.getImageData(0, 0, tw, th);
      // Extract RGB (skip alpha)
      const pixels: number[] = [];
      for (let i = 0; i < imageData.data.length; i += 4) {
        pixels.push(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
      }

      const indices = matchImageToMard(pixels, algorithm);

      // Build CanvasData
      const canvasData: CanvasData = [];
      for (let r = 0; r < th; r++) {
        const row = [];
        for (let c = 0; c < tw; c++) {
          row.push({ colorIndex: indices[r * tw + c] });
        }
        canvasData.push(row);
      }

      setPreview({ data: canvasData, w: tw, h: th });

      // Draw preview
      requestAnimationFrame(() => {
        const pCanvas = previewCanvasRef.current;
        if (!pCanvas) return;
        const cellSize = Math.min(300 / tw, 300 / th);
        pCanvas.width = tw * cellSize;
        pCanvas.height = th * cellSize;
        const pCtx = pCanvas.getContext('2d')!;
        for (let r = 0; r < th; r++) {
          for (let c = 0; c < tw; c++) {
            const idx = canvasData[r][c].colorIndex;
            pCtx.fillStyle = idx !== null ? MARD_COLORS[idx].hex : '#fff';
            pCtx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
          }
        }
      });
    } finally {
      setProcessing(false);
    }
  }, [imageSrc, maxDim, algorithm, resizeMode, widthRatio]);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-[#1a1a2e] text-white px-4 py-3 flex items-center">
        <button onClick={onBack} className="mr-3 text-lg">←</button>
        <h2 className="text-lg font-semibold">导入图片</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* File input */}
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center active:bg-gray-50"
        >
          {imageSrc ? (
            <img src={imageSrc} className="max-h-48 mx-auto rounded" alt="preview" />
          ) : (
            <div className="text-gray-400">
              <div className="text-4xl mb-2">📷</div>
              <p>点击选择图片</p>
              <p className="text-xs mt-1">支持拍照或从相册选择</p>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />

        {imageSrc && (
          <>
            <p className="text-xs text-gray-400">原图尺寸: {naturalSize.w} × {naturalSize.h}</p>

            {/* Max dimension */}
            <div>
              <label className="text-sm font-medium text-gray-700">最大尺寸: {maxDim}</label>
              <input type="range" min={8} max={104} value={maxDim} onChange={e => setMaxDim(+e.target.value)} className="w-full mt-1" />
              <div className="flex gap-2 mt-1">
                {PRESETS.map(p => (
                  <button key={p} onClick={() => setMaxDim(p)}
                    className={`px-3 py-1 rounded text-xs ${maxDim === p ? 'bg-[#e94560] text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Algorithm */}
            <div>
              <label className="text-sm font-medium text-gray-700">配色算法</label>
              <div className="flex gap-2 mt-1">
                {(['euclidean', 'ciede2000'] as const).map(a => (
                  <button key={a} onClick={() => setAlgorithm(a)}
                    className={`flex-1 py-2 rounded text-sm ${algorithm === a ? 'bg-[#e94560] text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {a === 'euclidean' ? '欧氏距离' : 'CIEDE2000'}
                  </button>
                ))}
              </div>
            </div>

            {/* Resize mode */}
            <div>
              <label className="text-sm font-medium text-gray-700">缩放模式</label>
              <div className="flex gap-2 mt-1">
                {(['smooth', 'sharp'] as const).map(m => (
                  <button key={m} onClick={() => setResizeMode(m)}
                    className={`flex-1 py-2 rounded text-sm ${resizeMode === m ? 'bg-[#e94560] text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {m === 'smooth' ? '平滑' : '锐利'}
                  </button>
                ))}
              </div>
            </div>

            {/* Width ratio */}
            <div>
              <label className="text-sm font-medium text-gray-700">宽度比例: {widthRatio.toFixed(2)}</label>
              <input type="range" min={0.5} max={2} step={0.05} value={widthRatio} onChange={e => setWidthRatio(+e.target.value)} className="w-full mt-1" />
            </div>

            {/* Generate */}
            <button onClick={generate} disabled={processing}
              className="w-full py-3 rounded-xl bg-[#e94560] text-white text-lg font-semibold disabled:opacity-50">
              {processing ? '生成中...' : '生成预览'}
            </button>

            {/* Preview result */}
            {preview && (
              <div className="mt-4">
                <p className="text-sm text-gray-600 mb-2">预览 ({preview.w} × {preview.h})</p>
                <div className="flex justify-center">
                  <canvas ref={previewCanvasRef} className="border rounded" style={{ imageRendering: 'pixelated' }} />
                </div>
                <button onClick={() => onResult(preview.data, preview.w, preview.h)}
                  className="w-full mt-4 py-3 rounded-xl bg-green-600 text-white text-lg font-semibold">
                  确认使用
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
