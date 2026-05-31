/**
 * Tiny PNG tEXt chunk reader. Avoids pulling in pngjs (~50 KB) for one
 * chunk type. Mirrors the Rust `read_blueprint_metadata` in
 * src-tauri/src/commands/blueprint_import.rs.
 */

export interface BlueprintPngMetadata {
  v: number;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  originX: number;
  originY: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const KEYWORD = "pindouverse-blueprint";

/** Returns null if input isn't a PNG, has no tEXt chunk with the keyword,
 *  or the chunk's JSON has v !== 1. */
export function readBlueprintMetadata(bytes: Uint8Array): BlueprintPngMetadata | null {
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }

  // Walk chunks: [len:u32be][type:4][data:len][crc:u32be]
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const len =
      (bytes[cursor] << 24) |
      (bytes[cursor + 1] << 16) |
      (bytes[cursor + 2] << 8) |
      bytes[cursor + 3];
    const type = String.fromCharCode(
      bytes[cursor + 4],
      bytes[cursor + 5],
      bytes[cursor + 6],
      bytes[cursor + 7],
    );
    const dataStart = cursor + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) return null;

    if (type === "tEXt") {
      // data is: keyword \0 text (both Latin-1)
      let zero = dataStart;
      while (zero < dataEnd && bytes[zero] !== 0) zero++;
      if (zero < dataEnd) {
        const kw = latin1Decode(bytes, dataStart, zero);
        if (kw === KEYWORD) {
          const text = latin1Decode(bytes, zero + 1, dataEnd);
          try {
            const parsed = JSON.parse(text);
            if (
              parsed &&
              parsed.v === 1 &&
              typeof parsed.gridWidth === "number" &&
              typeof parsed.gridHeight === "number" &&
              typeof parsed.cellSize === "number" &&
              typeof parsed.originX === "number" &&
              typeof parsed.originY === "number"
            ) {
              return parsed as BlueprintPngMetadata;
            }
          } catch {
            // fall through; keep walking in case there's another tEXt
          }
        }
      }
    }

    if (type === "IDAT") {
      // tEXt always appears before image data; no point reading further
      return null;
    }

    cursor = dataEnd + 4; // skip data + CRC
  }
  return null;
}

function latin1Decode(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
