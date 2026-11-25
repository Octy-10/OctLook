/**
 * Non-destructive colour adjustments. Everything folds into one 4 × 5 colour
 * matrix (sRGB, unpremultiplied) that drives both the live SVG filter and the
 * exporter, so what is saved is exactly what was previewed.
 */

export interface Adjustments {
  /** −100 … 100 */
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  /** −180 … 180 degrees */
  hue: number;
  grayscale: boolean;
  invert: boolean;
}

export const NEUTRAL: Adjustments = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  grayscale: false,
  invert: false,
};

export const isNeutral = (a: Adjustments) => (Object.keys(NEUTRAL) as (keyof Adjustments)[]).every((k) => a[k] === NEUTRAL[k]);

/** Row-major rows R, G, B, A; columns r, g, b, a, offset (offset in 0 … 1). */
export type ColorMatrix = number[];

const LUMA = [0.2126, 0.7152, 0.0722];
/** Stops of exposure at the slider's end. */
const EXPOSURE_STOPS = 1.5;
/** Channel gain swing of the white-balance sliders at their end. */
const BALANCE = 0.25;

const rgb = (m: number[], offset = 0): ColorMatrix => [
  m[0], m[1], m[2], 0, offset,
  m[3], m[4], m[5], 0, offset,
  m[6], m[7], m[8], 0, offset,
  0, 0, 0, 1, 0,
];

const gain = (r: number, g: number, b: number, offset = 0) => rgb([r, 0, 0, 0, g, 0, 0, 0, b], offset);

const saturate = (s: number) => rgb([0, 1, 2].flatMap((row) => LUMA.map((l, col) => l * (1 - s) + (row === col ? s : 0))));

function hueRotate(degrees: number) {
  const cos = Math.cos((degrees * Math.PI) / 180);
  const sin = Math.sin((degrees * Math.PI) / 180);
  return rgb([
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ]);
}

/** `after ∘ before`: the matrix that applies `before`, then `after`. */
function compose(before: ColorMatrix, after: ColorMatrix): ColorMatrix {
  const out = new Array<number>(20);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let v = col === 4 ? after[row * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += after[row * 5 + k] * before[k * 5 + col];
      out[row * 5 + col] = v;
    }
  }
  return out;
}

export function colorMatrix(a: Adjustments): ColorMatrix {
  const warm = (a.temperature / 100) * BALANCE;
  const magenta = (a.tint / 100) * BALANCE;
  const exposure = 2 ** ((a.exposure / 100) * EXPOSURE_STOPS);
  const contrast = 1 + a.contrast / 100;
  return [
    gain((1 + warm) * exposure, (1 - magenta) * exposure, (1 - warm) * exposure),
    gain(contrast, contrast, contrast, 0.5 * (1 - contrast)),
    saturate(a.grayscale ? 0 : 1 + a.saturation / 100),
    hueRotate(a.hue),
    a.invert ? gain(-1, -1, -1, 1) : gain(1, 1, 1),
  ].reduce(compose);
}

/** Applies `m` in place to RGBA8 pixels (alpha is left untouched). */
export function applyColorMatrix(data: Uint8ClampedArray, m: ColorMatrix) {
  const [rr, rg, rb, , ro, gr, gg, gb, , go, br, bg, bb, , bo] = m;
  const [or, og, ob] = [ro * 255, go * 255, bo * 255];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = rr * r + rg * g + rb * b + or;
    data[i + 1] = gr * r + gg * g + gb * b + og;
    data[i + 2] = br * r + bg * g + bb * b + ob;
  }
}
