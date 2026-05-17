import { useState, useEffect, useMemo } from "react";
import { useEditorStore } from "../../store/editorStore";
import { MARD_COLORS } from "../../data/mard221";
import { getEffectiveColor } from "../../utils/colorHelper";
import { getAdapter } from "../../adapters";
import {
  loadWatermarkSettings,
  saveWatermarkSettings,
  computeWatermarkLines,
  resolveWatermarkAuthor,
} from "../../utils/blueprintDecorations";
import type { WatermarkPayload } from "../../adapters";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const importedFileName = useEditorStore((s) => s.importedFileName);
  const projectPath = useEditorStore((s) => s.projectPath);
  const gridConfig = useEditorStore((s) => s.gridConfig);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const [watermark, setWatermark] = useState(() => loadWatermarkSettings());

  const projectAuthor = projectInfo?.author ?? "";
  const resolvedAuthor = resolveWatermarkAuthor(watermark.authorOverride, projectAuthor);
  const watermarkPayload: WatermarkPayload = useMemo(
    () => ({
      show_header: watermark.showHeader,
      app_description: watermark.appDescription.trim(),
      watermark_lines: computeWatermarkLines(watermark, projectAuthor),
    }),
    [watermark, projectAuthor]
  );

  // Persist settings when the dialog unmounts, even if the user closes without exporting
  useEffect(() => {
    return () => {
      saveWatermarkSettings(watermark);
    };
  }, [watermark]);

  const [cellSize, setCellSize] = useState(30);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [isExporting, setIsExporting] = useState(false);
  const [exportBlueprint, setExportBlueprint] = useState(true);
  const [exportPreview, setExportPreview] = useState(false);
  const [exportMirror, setExportMirror] = useState(false);

  const outputWidth = canvasSize.width * cellSize;
  const outputHeight = canvasSize.height * cellSize;

  const ext = format === "jpeg" ? "jpg" : format;
  const projectName = projectPath
    ? projectPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? null
    : null;
  const baseName = projectName || importedFileName || "pindou";

  const buildCells = () =>
    canvasData.map((row) =>
      row.map((cell) => {
        if (cell.colorIndex === null) return null;
        const base = MARD_COLORS[cell.colorIndex];
        if (!base) return null;
        const c = getEffectiveColor(cell.colorIndex, colorOverrides);
        return { color_code: base.code, r: c.rgb![0], g: c.rgb![1], b: c.rgb![2] };
      })
    );

  const mirrorCells = (cells: ReturnType<typeof buildCells>) =>
    cells.map((row) => [...row].reverse());

  const handleExport = async () => {
    if (!exportBlueprint && !exportPreview) return;

    const adapter = getAdapter();

    // Ask user to pick a folder (use save dialog for the blueprint path)
    let blueprintPath: string | null = null;
    if (exportBlueprint) {
      blueprintPath = await adapter.showSaveDialog(
        [
          format === "png"
            ? { name: "PNG Image", extensions: ["png"] }
            : { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
        ],
        `${baseName}_pindou_export.${ext}`,
      );
      if (!blueprintPath) return;
    }

    setIsExporting(true);
    try {
      const cells = buildCells();
      saveWatermarkSettings(watermark);
      const results: string[] = [];
      const errors: string[] = [];

      const tryExport = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
          results.push(label);
        } catch (e) {
          errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      if (exportBlueprint && blueprintPath) {
        await tryExport(`图纸: ${blueprintPath}`, () =>
          adapter.exportImage({
            width: canvasSize.width,
            height: canvasSize.height,
            cell_size: cellSize,
            cells,
            output_path: blueprintPath!,
            format,
            start_x: gridConfig.startX,
            start_y: gridConfig.startY,
            edge_padding: gridConfig.edgePadding,
            watermark: watermarkPayload,
          }),
        );

        if (exportMirror) {
          const mirrorPath = blueprintPath.replace(/\.([^.]+)$/, "_mirror.$1");
          await tryExport(`镜像图纸: ${mirrorPath}`, () =>
            adapter.exportImage({
              width: canvasSize.width,
              height: canvasSize.height,
              cell_size: cellSize,
              cells: mirrorCells(cells),
              output_path: mirrorPath,
              format,
              start_x: gridConfig.startX,
              start_y: gridConfig.startY,
              edge_padding: gridConfig.edgePadding,
              watermark: watermarkPayload,
            }),
          );
        }
      }

      if (exportPreview) {
        let previewPath: string;
        if (blueprintPath) {
          previewPath = blueprintPath.replace(/\.[^.]+$/, "_preview.jpg");
        } else {
          const selected = await adapter.showSaveDialog(
            [{ name: "JPEG Image", extensions: ["jpg", "jpeg"] }],
            `${baseName}_pindou_preview.jpg`,
          );
          if (!selected) {
            setIsExporting(false);
            return;
          }
          previewPath = selected;
        }

        await tryExport(`效果图: ${previewPath}`, () =>
          adapter.exportPreview({
            width: canvasSize.width,
            height: canvasSize.height,
            pixel_size: cellSize,
            cells,
            output_path: previewPath,
            watermark: watermarkPayload,
          }),
        );

        if (exportMirror) {
          const mirrorPreviewPath = previewPath.replace(/\.([^.]+)$/, "_mirror.$1");
          await tryExport(`镜像效果图: ${mirrorPreviewPath}`, () =>
            adapter.exportPreview({
              width: canvasSize.width,
              height: canvasSize.height,
              pixel_size: cellSize,
              cells: mirrorCells(cells),
              output_path: mirrorPreviewPath,
              watermark: watermarkPayload,
            }),
          );
        }
      }

      const successMsg = results.length ? `导出成功:\n${results.join("\n")}` : "";
      const errorMsg = errors.length ? `\n\n以下项目失败:\n${errors.join("\n")}` : "";
      alert(`${successMsg}${errorMsg}`.trim() || "未导出任何文件");
      onClose();
    } catch (e) {
      alert(`导出失败: ${e}`);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[440px]">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">导出高分辨率图片</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {/* Cell size */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">每像素大小 (px)</label>
            <input
              type="number"
              min={10}
              max={100}
              value={cellSize}
              onChange={(e) => setCellSize(Number(e.target.value))}
              className="w-20 px-2 py-1 text-xs border rounded"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">
              输出尺寸: {outputWidth}×{outputHeight} px
            </p>
          </div>

          {/* Format */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">格式</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="format"
                  checked={format === "png"}
                  onChange={() => setFormat("png")}
                />
                PNG
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="format"
                  checked={format === "jpeg"}
                  onChange={() => setFormat("jpeg")}
                />
                JPEG
              </label>
            </div>
          </div>

          {/* Export options */}
          <div>
            <label className="text-xs text-gray-600 mb-1 block">导出内容</label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportBlueprint}
                  onChange={(e) => setExportBlueprint(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>📋 图纸（带网格线、色号、坐标、色块统计）</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportPreview}
                  onChange={(e) => setExportPreview(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>🎨 效果图（模拟烫平后的样子，纯色块无辅助线）</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportMirror}
                  onChange={(e) => setExportMirror(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>🪞 同时导出左右镜像（拼豆背面视角）</span>
              </label>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-1 block">水印与署名</label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={watermark.showHeader}
                  onChange={(e) => setWatermark({ ...watermark, showHeader: e.target.checked })}
                  className="w-3.5 h-3.5"
                />
                <span>顶部应用标题（icon + PindouVerse）</span>
              </label>
              {watermark.showHeader && (
                <div className="pl-6">
                  <label className="text-[11px] text-gray-500 block mb-0.5">描述（可选）</label>
                  <input
                    type="text"
                    value={watermark.appDescription}
                    onChange={(e) => setWatermark({ ...watermark, appDescription: e.target.value })}
                    placeholder="例如 犬夜叉桔梗 64x72"
                    className="w-full px-2 py-1 text-xs border rounded"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={watermark.appWatermark}
                  onChange={(e) => setWatermark({ ...watermark, appWatermark: e.target.checked })}
                  className="w-3.5 h-3.5"
                />
                <span>在图中添加 PindouVerse 水印（45° 平铺）</span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={watermark.authorWatermark}
                  onChange={(e) => setWatermark({ ...watermark, authorWatermark: e.target.checked })}
                  className="w-3.5 h-3.5"
                />
                <span>在图中添加作者水印</span>
              </label>
              {watermark.authorWatermark && (
                <div className="pl-6">
                  <label className="text-[11px] text-gray-500 block mb-0.5">作者</label>
                  <input
                    type="text"
                    value={watermark.authorOverride}
                    onChange={(e) => setWatermark({ ...watermark, authorOverride: e.target.value })}
                    placeholder={projectAuthor || "(未设置)"}
                    className="w-full px-2 py-1 text-xs border rounded"
                  />
                  {!resolvedAuthor && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      未设置作者名，将不绘制作者水印
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleExport}
            disabled={isExporting || (!exportBlueprint && !exportPreview)}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-40"
          >
            {isExporting ? "导出中..." : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
