import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { MARD_COLORS } from "../../data/mard221";
import { getAdapter } from "../../adapters";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const importedFileName = useEditorStore((s) => s.importedFileName);
  const projectPath = useEditorStore((s) => s.projectPath);
  const gridConfig = useEditorStore((s) => s.gridConfig);

  const [cellSize, setCellSize] = useState(40);
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
        const c = MARD_COLORS[cell.colorIndex];
        return c
          ? { color_code: c.code, r: c.rgb![0], g: c.rgb![1], b: c.rgb![2] }
          : null;
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
      const results: string[] = [];

      if (exportBlueprint && blueprintPath) {
        await adapter.exportImage({
          width: canvasSize.width,
          height: canvasSize.height,
          cell_size: cellSize,
          cells,
          output_path: blueprintPath,
          format,
          start_x: gridConfig.startX,
          start_y: gridConfig.startY,
          edge_padding: gridConfig.edgePadding,
        });
        results.push(`图纸: ${blueprintPath}`);

        if (exportMirror) {
          const mirrorPath = blueprintPath.replace(/\.([^.]+)$/, "_mirror.$1");
          await adapter.exportImage({
            width: canvasSize.width,
            height: canvasSize.height,
            cell_size: cellSize,
            cells: mirrorCells(cells),
            output_path: mirrorPath,
            format,
            start_x: gridConfig.startX,
            start_y: gridConfig.startY,
            edge_padding: gridConfig.edgePadding,
          });
          results.push(`镜像图纸: ${mirrorPath}`);
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

        await adapter.exportPreview({
          width: canvasSize.width,
          height: canvasSize.height,
          pixel_size: cellSize,
          cells,
          output_path: previewPath,
        });
        results.push(`效果图: ${previewPath}`);

        if (exportMirror) {
          const mirrorPreviewPath = previewPath.replace(/\.([^.]+)$/, "_mirror.$1");
          await adapter.exportPreview({
            width: canvasSize.width,
            height: canvasSize.height,
            pixel_size: cellSize,
            cells: mirrorCells(cells),
            output_path: mirrorPreviewPath,
          });
          results.push(`镜像效果图: ${mirrorPreviewPath}`);
        }
      }

      alert(`导出成功:\n${results.join("\n")}`);
      onClose();
    } catch (e) {
      alert(`导出失败: ${e}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[380px]">
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
