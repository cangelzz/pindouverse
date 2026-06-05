import { useMemo } from 'react';
import type { CanvasData, BeadCount } from '@pindou/core';
import { MARD_COLORS, renderPixels } from '@pindou/core';
import BeadCanvas from '../components/BeadCanvas';

interface Props {
  canvasData: CanvasData;
  width: number;
  height: number;
  onNew: () => void;
}

export default function ResultPage({ canvasData, width, height, onNew }: Props) {
  const beadCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of canvasData) {
      for (const cell of row) {
        if (cell.colorIndex !== null) {
          map.set(cell.colorIndex, (map.get(cell.colorIndex) || 0) + 1);
        }
      }
    }
    const counts: BeadCount[] = [];
    for (const [idx, count] of map) {
      const c = MARD_COLORS[idx];
      counts.push({ colorIndex: idx, code: c.code, name: c.name, hex: c.hex, count });
    }
    counts.sort((a, b) => b.count - a.count);
    return counts;
  }, [canvasData]);

  const totalBeads = beadCounts.reduce((s, b) => s + b.count, 0);

  const exportPNG = () => {
    const cellSize = 10;
    const canvas = document.createElement('canvas');
    canvas.width = width * cellSize;
    canvas.height = height * cellSize;
    const ctx = canvas.getContext('2d')!;

    renderPixels(ctx, {
      canvasData,
      cellSize,
      offsetX: 0,
      offsetY: 0,
      viewWidth: canvas.width,
      viewHeight: canvas.height,
    });

    // Grid lines
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= height; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(width * cellSize, r * cellSize); ctx.stroke();
    }
    for (let c = 0; c <= width; c++) {
      ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, height * cellSize); ctx.stroke();
    }

    const link = document.createElement('a');
    link.download = `pindou_${width}x${height}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const saveProject = async () => {
    try {
      const { api } = await import('../utils/api');
      await api.saveProject({
        canvasSize: { width, height },
        canvasData,
        projectInfo: { title: `拼豆作品 ${width}×${height}` },
      });
      alert('保存成功！');
    } catch {
      alert('保存失败，请稍后重试');
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-[#1a1a2e] text-white px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">生成结果</h2>
        <span className="text-sm text-gray-400">{width} × {height}</span>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-[40vh] bg-gray-50">
        <BeadCanvas canvasData={canvasData} />
      </div>

      {/* Stats */}
      <div className="p-4">
        <div className="flex justify-between text-sm text-gray-600 mb-3">
          <span>共 {totalBeads} 颗豆</span>
          <span>{beadCounts.length} 种颜色</span>
        </div>

        <div className="max-h-40 overflow-y-auto border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="py-1 px-2 text-left">颜色</th>
                <th className="py-1 px-2 text-left">编号</th>
                <th className="py-1 px-2 text-left">名称</th>
                <th className="py-1 px-2 text-right">数量</th>
              </tr>
            </thead>
            <tbody>
              {beadCounts.map(b => (
                <tr key={b.colorIndex} className="border-t">
                  <td className="py-1 px-2"><span className="inline-block w-4 h-4 rounded" style={{ background: b.hex }} /></td>
                  <td className="py-1 px-2 text-gray-500">{b.code}</td>
                  <td className="py-1 px-2">{b.name}</td>
                  <td className="py-1 px-2 text-right font-mono">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="mt-4 space-y-3">
          <button onClick={exportPNG} className="w-full py-3 rounded-xl bg-[#e94560] text-white font-semibold">
            导出PNG图片
          </button>
          <button onClick={saveProject} className="w-full py-3 rounded-xl border border-[#e94560] text-[#e94560] font-semibold">
            保存作品
          </button>
          <button onClick={onNew} className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-semibold">
            新建作品
          </button>
        </div>
      </div>
    </div>
  );
}
