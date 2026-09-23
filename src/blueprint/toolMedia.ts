import type { PixelData, ExportImageRequest } from "../adapters";
import type { ColorMatchAlgorithm, ProjectFile } from "../types";
import { getEffectiveColor, type ColorOverrideMap } from "../utils/colorHelper";
import type { ToolInput } from "./toolContract";
import { matchImageToMard } from "../utils/colorMatching";
import { MARD_COLORS } from "../data/mard221";
import { loadWatermarkSettings, composeHeaderDescription, resolveWatermarkAuthor, computeWatermarkLines } from "../utils/blueprintDecorations";

export interface ToolMediaServices {
  importPixels(input: ToolInput<"import_image">, signal: AbortSignal): Promise<PixelData>;
  exportImage(request: ExportImageRequest, signal: AbortSignal): Promise<void>;
}
export function mapToolImportPixels(pixels: PixelData, algorithm: ColorMatchAlgorithm, overrides: ColorOverrideMap): { row: number; col: number; colorIndex: number }[] {
  if (!Number.isInteger(pixels.width) || !Number.isInteger(pixels.height)
    || pixels.width < 1 || pixels.height < 1 || pixels.width > 256 || pixels.height > 256
    || pixels.pixels.length !== pixels.width * pixels.height * 3
    || pixels.pixels.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new RangeError("Invalid imported pixel buffer");
  return matchImageToMard(pixels.pixels, algorithm, "mard221", overrides).map((colorIndex, offset) => ({
    row: Math.floor(offset / pixels.width), col: offset % pixels.width, colorIndex,
  }));
}

export function buildToolExportRequest(project: ProjectFile, overrides: ColorOverrideMap, settings: ToolInput<"export_blueprint">,
  labels: ExportImageRequest["labels"]): ExportImageRequest {
  const watermark = loadWatermarkSettings();
  return {
    width: project.canvasSize.width, height: project.canvasSize.height, cell_size: settings.cellSize,
    output_path: settings.path ?? "", format: settings.format,
    start_x: project.gridConfig?.startX ?? 0, start_y: project.gridConfig?.startY ?? 0, edge_padding: project.gridConfig?.edgePadding ?? 0,
    labels, legend_options: { include_by_count: true, include_by_name: false },
    watermark: {
      show_header: watermark.showHeader,
      app_description: composeHeaderDescription(project.projectInfo?.title ?? "", resolveWatermarkAuthor(watermark.authorOverride, project.projectInfo?.author ?? "")),
      watermark_lines: computeWatermarkLines(watermark, project.projectInfo?.author ?? ""),
    },
    cells: project.canvasData.map(row => row.map(cell => {
      if (cell.colorIndex === null) return null;
      const base = MARD_COLORS[cell.colorIndex];
      const rgb = getEffectiveColor(cell.colorIndex, overrides).rgb ?? [255, 255, 255];
      return { color_code: base.code, r: rgb[0], g: rgb[1], b: rgb[2] };
    })),
  };
}