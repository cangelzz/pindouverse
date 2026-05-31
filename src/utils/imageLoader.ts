/**
 * Load a blueprint image: bytes via adapter, decoded RGBA via the browser's
 * native image decoder. Used by the TS blueprint importer (VS Code webview +
 * browser); Tauri path doesn't need this (Rust does its own decoding).
 */

export interface LoadedImage {
  /** RGBA, length = width * height * 4 */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Raw file bytes — passed to pngMetadata.readBlueprintMetadata for PNG. */
  rawBytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg" | "image/bmp" | "application/octet-stream";
}

interface ReadFileAdapter {
  readFileBase64(path: string): Promise<string>;
}

export async function loadImageData(
  path: string,
  adapter: ReadFileAdapter,
): Promise<LoadedImage> {
  const base64 = await adapter.readFileBase64(path);
  const rawBytes = base64ToUint8Array(base64);
  const mediaType = detectMediaType(path);

  const dataUrl = `data:${mediaType};base64,${base64}`;
  const img = await loadImage(dataUrl);
  const { width, height } = img;
  if (width === 0 || height === 0) {
    throw new Error("Image decoded to 0×0");
  }

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  return {
    data: imageData.data,
    width,
    height,
    rawBytes,
    mediaType,
  };
}

function detectMediaType(path: string): LoadedImage["mediaType"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "application/octet-stream";
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode image at ${src.slice(0, 64)}…`));
    img.src = src;
  });
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
