import { describe, it, expect, vi } from "vitest";
import { drawTransparentBeadMarker, renderPixels } from "./canvasRenderer";
import { TRANSPARENT_BEAD_INDEX } from "../data/mard221";
import type { CanvasData } from "../types";

function mockCtx() {
  return {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
  } as unknown as CanvasRenderingContext2D;
}

const baseOpts = {
  cellSize: 20,
  offsetX: 0,
  offsetY: 0,
  viewWidth: 100,
  viewHeight: 100,
};

describe("drawTransparentBeadMarker", () => {
  it("draws a full X at normal cell size (no fill)", () => {
    const ctx = mockCtx();
    drawTransparentBeadMarker(ctx, 0, 0, 20);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect((ctx.moveTo as any).mock.calls.length).toBe(2);
    expect((ctx.lineTo as any).mock.calls.length).toBe(2);
  });
  it("degrades to a single diagonal at tiny cell size", () => {
    const ctx = mockCtx();
    drawTransparentBeadMarker(ctx, 0, 0, 4);
    expect((ctx.moveTo as any).mock.calls.length).toBe(1);
    expect((ctx.lineTo as any).mock.calls.length).toBe(1);
  });
  it("draws full X at the exact threshold (cellSize=6)", () => {
    const ctx = mockCtx();
    drawTransparentBeadMarker(ctx, 0, 0, 6);
    expect((ctx.moveTo as any).mock.calls.length).toBe(2);
    expect((ctx.lineTo as any).mock.calls.length).toBe(2);
  });
});

describe("renderPixels transparent bead", () => {
  it("does NOT solid-fill the H1 cell but strokes a marker", () => {
    const ctx = mockCtx();
    const data: CanvasData = [[{ colorIndex: TRANSPARENT_BEAD_INDEX }]];
    renderPixels(ctx, { ...baseOpts, canvasData: data });
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });
  it("solid-fills a normal color cell", () => {
    const ctx = mockCtx();
    const data: CanvasData = [[{ colorIndex: 0 }]];
    renderPixels(ctx, { ...baseOpts, canvasData: data });
    expect(ctx.fillRect).toHaveBeenCalled();
  });
  it("draws nothing for an empty cell", () => {
    const ctx = mockCtx();
    const data: CanvasData = [[{ colorIndex: null }]];
    renderPixels(ctx, { ...baseOpts, canvasData: data });
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
  it("does NOT paint the dim wash over an H1 cell when another color is highlighted", () => {
    const ctx = mockCtx();
    const data: CanvasData = [[{ colorIndex: TRANSPARENT_BEAD_INDEX }]];
    renderPixels(ctx, { ...baseOpts, canvasData: data, highlightColorIndex: 0 });
    expect(ctx.fillRect).not.toHaveBeenCalled(); // no dim wash painted over the X
    expect(ctx.stroke).toHaveBeenCalled();       // X marker still drawn
  });
});
