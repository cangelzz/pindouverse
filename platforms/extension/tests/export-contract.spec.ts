import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAdapter } from "../../../src/adapters/browser";

const { renderBlueprintBlob, renderPreviewBlob } = vi.hoisted(() => ({
  renderBlueprintBlob: vi.fn(),
  renderPreviewBlob: vi.fn(),
}));

vi.mock("../../../src/utils/canvasExport", () => ({
  renderBlueprintBlob,
  renderPreviewBlob,
}));

const clicks: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  clicks.length = 0;
  renderBlueprintBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  renderPreviewBlob.mockResolvedValue(new Blob(["jpg"], { type: "image/jpeg" }));
  vi.stubGlobal("Image", class {
    set src(_value: string) { queueMicrotask(() => (this as any).onerror?.()); }
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("document", {
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    createElement: vi.fn((tag: string) => {
      if (tag !== "a") throw new Error(`unexpected element: ${tag}`);
      return {
        href: "",
        download: "",
        click() { clicks.push(this.download); },
      };
    }),
  });
});

const cells = [[{ color_code: "A1", r: 1, g: 2, b: 3 }]];

describe("browser export contract", () => {
  it("passes the complete blueprint request without output_path to the shared renderer and downloads its filename", async () => {
    await new BrowserAdapter().exportImage({
      width: 1,
      height: 1,
      cell_size: 20,
      cells,
      output_path: "folder/design.jpeg",
      format: "jpeg",
      start_x: 7,
      start_y: 8,
      edge_padding: 1,
      watermark: { show_header: false, app_description: "Title - Author", watermark_lines: ["Author"] },
      legend_options: { include_by_count: true, include_by_name: true },
    });

    expect(renderBlueprintBlob).toHaveBeenCalledWith(expect.objectContaining({
      width: 1,
      height: 1,
      format: "jpeg",
      start_x: 7,
      start_y: 8,
      edge_padding: 1,
      watermark: expect.any(Object),
      legend_options: { include_by_count: true, include_by_name: true },
    }), { appIcon: null });
    expect(renderBlueprintBlob.mock.calls[0][0]).not.toHaveProperty("output_path");
    expect(clicks).toEqual(["design.jpeg"]);
  });

  it("routes preview through the same renderer boundary and preserves the requested filename", async () => {
    await new BrowserAdapter().exportPreview({
      width: 1,
      height: 1,
      pixel_size: 4,
      cells,
      output_path: "C:\\out\\preview.jpg",
    });
    expect(renderPreviewBlob.mock.calls[0][0]).not.toHaveProperty("output_path");
    expect(clicks).toEqual(["preview.jpg"]);
  });

  it("VS Code passes the same renderer request and only base64-sinks the returned Blob", async () => {
    vi.resetModules();
    const messages: any[] = [];
    const eventTarget = new EventTarget();
    vi.stubGlobal("window", eventTarget);
    vi.stubGlobal("acquireVsCodeApi", () => ({
      getState: () => undefined,
      setState: () => undefined,
      postMessage(message: any) {
        messages.push(message);
        if (message.type === "writeFile") {
          queueMicrotask(() => eventTarget.dispatchEvent(new MessageEvent("message", {
            data: { type: "fileResult", requestId: message.requestId, success: true },
          })));
        }
      },
    }));
    vi.stubGlobal("FileReader", class {
      result: string | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() {
        this.result = "data:image/png;base64,cG5n";
        queueMicrotask(() => this.onload?.());
      }
    });

    const { VScodeAdapter } = await import("../../vscode/src/vscodeAdapter");
    const request = {
      width: 1,
      height: 1,
      cell_size: 20,
      cells,
      output_path: "/out/design.png",
      format: "png" as const,
      start_x: 7,
      start_y: 8,
      edge_padding: 1,
    };
    await new VScodeAdapter().exportImage(request);

    expect(renderBlueprintBlob.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      width: 1, format: "png", start_x: 7, start_y: 8, edge_padding: 1,
    }));
    expect(renderBlueprintBlob.mock.calls.at(-1)?.[0]).not.toHaveProperty("output_path");
    expect(messages.at(-1)).toEqual(expect.objectContaining({
      type: "writeFile", path: "/out/design.png", data: "cG5n",
    }));
  });
});
