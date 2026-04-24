/**
 * RGB ↔ CIELAB color space conversion
 * Reference: https://en.wikipedia.org/wiki/CIELAB_color_space
 */

export type Lab = [number, number, number]; // [L, a, b]
export type RGB = [number, number, number]; // [r, g, b]

function linearize(c: number): number {
  const v = c / 255;
  return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
}

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

/** D65 illuminant reference white */
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rLin = linearize(r);
  const gLin = linearize(g);
  const bLin = linearize(b);

  const x = 0.4124564 * rLin + 0.3575761 * gLin + 0.1804375 * bLin;
  const y = 0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin;
  const z = 0.0193339 * rLin + 0.1191920 * gLin + 0.9503041 * bLin;

  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return [L, a, bVal];
}

export function deltaE76(lab1: Lab, lab2: Lab): number {
  return Math.sqrt(
    (lab1[0] - lab2[0]) ** 2 +
    (lab1[1] - lab2[1]) ** 2 +
    (lab1[2] - lab2[2]) ** 2
  );
}

export function euclideanRGB(rgb1: RGB, rgb2: RGB): number {
  return Math.sqrt(
    (rgb1[0] - rgb2[0]) ** 2 +
    (rgb1[1] - rgb2[1]) ** 2 +
    (rgb1[2] - rgb2[2]) ** 2
  );
}
