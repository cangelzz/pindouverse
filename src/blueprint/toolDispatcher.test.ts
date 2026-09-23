import { beforeAll, expect, it } from "vitest";
import { lineCells, rectCells, circleCells } from "../utils/shapeDrawing";
import type { ToolInput } from "./toolContract";

let planShapeCells: typeof import("./toolDispatcher")["planShapeCells"];
beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined } });
  ({ planShapeCells } = await import("./toolDispatcher"));
});

const shapes: [ToolInput<"draw_shape">["shape"], [number, number][]][] = [
  [{ kind: "line", start: { x: 0, y: 0 }, end: { x: 3, y: 2 } }, lineCells(0, 0, 2, 3)],
  [{ kind: "rectangle", region: { x: 0, y: 0, width: 1, height: 1 }, filled: false }, rectCells(0, 0, 0, 0, false)],
  [{ kind: "rectangle", region: { x: 1, y: 2, width: 2, height: 3 }, filled: true }, rectCells(2, 1, 4, 2, true)],
  [{ kind: "circle", center: { x: 2, y: 2 }, radius: 0, filled: false }, circleCells(2, 2, 0, false)],
  [{ kind: "circle", center: { x: 2, y: 2 }, radius: 2, filled: true }, circleCells(2, 2, 2, true)],
];

it.each(shapes)("preserves editor rasterization for %j", (shape, expected) => {
  expect(planShapeCells(shape)).toEqual(expected);
});