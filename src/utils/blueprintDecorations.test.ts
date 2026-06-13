import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_WATERMARK_SETTINGS,
  computeHeaderHeight,
  resolveWatermarkAuthor,
  computeWatermarkLines,
  composeHeaderDescription,
  loadWatermarkSettings,
  saveWatermarkSettings,
  drawHeader,
  drawWatermark,
  computeWatermarkLineCount,
} from "./blueprintDecorations";
import type { ExportWatermarkSettings } from "../types";

describe("computeHeaderHeight", () => {
  it("returns 0 when showHeader=false", () => {
    expect(computeHeaderHeight(20, false)).toBe(0);
  });
  it("returns 2 * cellSize when showHeader=true", () => {
    expect(computeHeaderHeight(20, true)).toBe(40);
    expect(computeHeaderHeight(35, true)).toBe(70);
  });
});

describe("resolveWatermarkAuthor", () => {
  it("returns project author when set (takes priority over last-used)", () => {
    expect(resolveWatermarkAuthor("Alice", "Bob")).toBe("Bob");
  });
  it("trims the project author", () => {
    expect(resolveWatermarkAuthor("Alice", "  Bob  ")).toBe("Bob");
  });
  it("falls back to last-used when project author empty", () => {
    expect(resolveWatermarkAuthor("Alice", "")).toBe("Alice");
    expect(resolveWatermarkAuthor("  Alice  ", "   ")).toBe("Alice");
  });
  it("returns empty string when both empty", () => {
    expect(resolveWatermarkAuthor("", "")).toBe("");
    expect(resolveWatermarkAuthor(undefined as any, undefined as any)).toBe("");
  });
});

describe("computeWatermarkLines", () => {
  const baseSettings: ExportWatermarkSettings = {
    ...DEFAULT_WATERMARK_SETTINGS,
    appWatermark: false,
    authorWatermark: false,
  };

  it("returns empty when both watermarks off", () => {
    expect(computeWatermarkLines(baseSettings, "Bob")).toEqual([]);
  });
  it("returns only PindouVerse when only appWatermark on", () => {
    expect(
      computeWatermarkLines({ ...baseSettings, appWatermark: true }, "Bob")
    ).toEqual(["PindouVerse"]);
  });
  it("returns only author when only authorWatermark on with author", () => {
    expect(
      computeWatermarkLines({ ...baseSettings, authorWatermark: true }, "Bob")
    ).toEqual(["Bob"]);
  });
  it("returns empty when authorWatermark on but author empty", () => {
    expect(
      computeWatermarkLines({ ...baseSettings, authorWatermark: true }, "")
    ).toEqual([]);
  });
  it("returns both lines when both on and author non-empty", () => {
    expect(
      computeWatermarkLines(
        { ...baseSettings, appWatermark: true, authorWatermark: true },
        "Bob"
      )
    ).toEqual(["PindouVerse", "Bob"]);
  });
  it("falls back to only PindouVerse when authorWatermark on but author empty", () => {
    expect(
      computeWatermarkLines(
        { ...baseSettings, appWatermark: true, authorWatermark: true },
        ""
      )
    ).toEqual(["PindouVerse"]);
  });
});

describe("composeHeaderDescription", () => {
  it("joins title and author with ' - '", () => {
    expect(composeHeaderDescription("Kikyou 64x72", "Alice")).toBe("Kikyou 64x72 - Alice");
  });
  it("returns only the title when author is empty", () => {
    expect(composeHeaderDescription("Kikyou 64x72", "")).toBe("Kikyou 64x72");
    expect(composeHeaderDescription("Kikyou 64x72", "   ")).toBe("Kikyou 64x72");
  });
  it("returns only the author when title is empty", () => {
    expect(composeHeaderDescription("", "Alice")).toBe("Alice");
  });
  it("returns empty string when both are empty", () => {
    expect(composeHeaderDescription("", "")).toBe("");
    expect(composeHeaderDescription(undefined as any, undefined as any)).toBe("");
  });
  it("trims each part", () => {
    expect(composeHeaderDescription("  title  ", "  Bob  ")).toBe("title - Bob");
  });
});

describe("settings persistence", () => {
  const KEY = "pindouverse.exportWatermark";

  // Provide a minimal localStorage stub (jsdom not installed in this project).
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns defaults when nothing stored", () => {
    expect(loadWatermarkSettings()).toEqual(DEFAULT_WATERMARK_SETTINGS);
  });

  it("round-trips persisted fields", () => {
    const s: ExportWatermarkSettings = {
      showHeader: false,
      appDescription: "hello",
      appWatermark: true,
      authorWatermark: false,
      authorOverride: "Alice",
    };
    saveWatermarkSettings(s);
    const loaded = loadWatermarkSettings();
    expect(loaded.showHeader).toBe(false);
    expect(loaded.appDescription).toBe("hello");
    expect(loaded.appWatermark).toBe(true);
    expect(loaded.authorWatermark).toBe(false);
    expect(loaded.authorOverride).toBe("Alice");
  });

  it("ignores malformed JSON gracefully", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadWatermarkSettings()).toEqual(DEFAULT_WATERMARK_SETTINGS);
  });

  it("fills in missing fields with defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ showHeader: false }));
    const loaded = loadWatermarkSettings();
    expect(loaded.showHeader).toBe(false);
    expect(loaded.appDescription).toBe(DEFAULT_WATERMARK_SETTINGS.appDescription);
    expect(loaded.appWatermark).toBe(DEFAULT_WATERMARK_SETTINGS.appWatermark);
    expect(loaded.authorWatermark).toBe(DEFAULT_WATERMARK_SETTINGS.authorWatermark);
  });
});

// ---------------------------------------------------------------------------
// Canvas helpers — jsdom and the canvas package are not installed in this
// project, so getImageData is unavailable. Tests use vi.spyOn to assert that
// the expected CanvasRenderingContext2D methods are called with the right
// arguments instead of inspecting pixel data.
// ---------------------------------------------------------------------------

function makeCtx() {
  return {
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    lineWidth: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low" as ImageSmoothingQuality,
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 80 }),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("computeWatermarkLineCount", () => {
  it("returns at least 2 lines for small grids", () => {
    expect(computeWatermarkLineCount(100, 100, 20)).toBeGreaterThanOrEqual(2);
  });
  it("scales line count with diagonal length", () => {
    const small = computeWatermarkLineCount(100, 100, 20);
    const large = computeWatermarkLineCount(2000, 2000, 20);
    expect(large).toBeGreaterThan(small);
  });
});

describe("drawHeader (spy-based — canvas package not installed)", () => {
  it("calls fillRect to paint the header background", () => {
    const ctx = makeCtx();
    drawHeader(ctx, {
      cellSize: 20,
      width: 400,
      headerHeight: 40,
      iconImage: null,
      description: "test",
    });
    expect(ctx.fillRect).toHaveBeenCalled();
    // First call should cover the full header strip
    const [x, y, w, h] = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(w).toBe(400);
    expect(h).toBe(40);
  });

  it("calls fillText with a string containing the description", () => {
    const ctx = makeCtx();
    drawHeader(ctx, {
      cellSize: 20,
      width: 400,
      headerHeight: 40,
      iconImage: null,
      description: "hello world",
    });
    expect(ctx.fillText).toHaveBeenCalled();
    const textArg = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(textArg).toContain("hello world");
  });

  it("returns immediately when headerHeight <= 0", () => {
    const ctx = makeCtx();
    drawHeader(ctx, {
      cellSize: 20,
      width: 400,
      headerHeight: 0,
      iconImage: null,
      description: "test",
    });
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("calls drawImage when iconImage is provided", () => {
    const ctx = makeCtx();
    const fakeIcon = {} as CanvasImageSource;
    drawHeader(ctx, {
      cellSize: 20,
      width: 400,
      headerHeight: 40,
      iconImage: fakeIcon,
      description: "test",
    });
    expect(ctx.drawImage).toHaveBeenCalledWith(fakeIcon, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  });
});

describe("drawWatermark (spy-based — canvas package not installed)", () => {
  it("does nothing when lines is empty", () => {
    const ctx = makeCtx();
    drawWatermark(ctx, {
      cellSize: 20,
      gridX: 0,
      gridY: 0,
      gridW: 200,
      gridH: 200,
      lines: [],
    });
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("calls fillText at least once when given lines", () => {
    const ctx = makeCtx();
    drawWatermark(ctx, {
      cellSize: 20,
      gridX: 0,
      gridY: 0,
      gridW: 400,
      gridH: 400,
      lines: ["TEST"],
    });
    expect(ctx.fillText).toHaveBeenCalled();
    const textArg = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(textArg).toBe("TEST");
  });

  it("calls save/restore to guard state", () => {
    const ctx = makeCtx();
    drawWatermark(ctx, {
      cellSize: 20,
      gridX: 0,
      gridY: 0,
      gridW: 400,
      gridH: 400,
      lines: ["TEST"],
    });
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });
});
