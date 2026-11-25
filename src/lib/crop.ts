/** Pure crop-rectangle math, in content pixels (before rotation / flips). */

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const fullCrop = (w: number, h: number): Crop => ({ x: 0, y: 0, width: w, height: h });

/**
 * `c` resized to width × height about its centre; scaled down uniformly
 * (keeping the typed proportions) to fit a w × h image, and kept inside it.
 */
export function sizeCrop(c: Crop, width: number, height: number, w: number, h: number): Crop {
  const fit = Math.min(1, w / width, h / height);
  const [cw, ch] = [Math.max(MIN_SIZE, width * fit), Math.max(MIN_SIZE, height * fit)];
  return { x: clamp(c.x + (c.width - cw) / 2, 0, w - cw), y: clamp(c.y + (c.height - ch) / 2, 0, h - ch), width: cw, height: ch };
}

export function moveCrop(c: Crop, dx: number, dy: number, w: number, h: number): Crop {
  return { ...c, x: clamp(c.x + dx, 0, w - c.width), y: clamp(c.y + dy, 0, h - c.height) };
}

/**
 * Drags the handle (hx, hy ∈ −1 | 0 | 1) of `c` to the point (px, py) inside
 * a w × h image. With `ratio` (width / height) the opposite corner — or, for
 * edge handles, the centre line — stays anchored.
 */
export function resizeCrop(c: Crop, hx: number, hy: number, px: number, py: number, w: number, h: number, ratio: number | null): Crop {
  let x0 = c.x;
  let y0 = c.y;
  let x1 = c.x + c.width;
  let y1 = c.y + c.height;
  if (hx < 0) x0 = clamp(px, 0, x1 - MIN_SIZE);
  if (hx > 0) x1 = clamp(px, x0 + MIN_SIZE, w);
  if (hy < 0) y0 = clamp(py, 0, y1 - MIN_SIZE);
  if (hy > 0) y1 = clamp(py, y0 + MIN_SIZE, h);
  let width = x1 - x0;
  let height = y1 - y0;
  if (!ratio) return { x: x0, y: y0, width, height };

  if (hx && hy) {
    const ax = hx < 0 ? x1 : x0;
    const ay = hy < 0 ? y1 : y0;
    width = Math.min(Math.max(width, height * ratio), hx < 0 ? ax : w - ax, (hy < 0 ? ay : h - ay) * ratio);
    height = width / ratio;
    return { x: hx < 0 ? ax - width : ax, y: hy < 0 ? ay - height : ay, width, height };
  }
  if (hx) {
    const cy = c.y + c.height / 2;
    width = Math.min(width, 2 * Math.min(cy, h - cy) * ratio);
    height = width / ratio;
    return { x: hx < 0 ? x1 - width : x0, y: cy - height / 2, width, height };
  }
  const cx = c.x + c.width / 2;
  height = Math.min(height, (2 * Math.min(cx, w - cx)) / ratio);
  width = height * ratio;
  return { x: cx - width / 2, y: hy < 0 ? y1 - height : y0, width, height };
}

/** Reshapes `c` to `ratio` around its centre, shrinking to stay inside the image. */
export function constrainCrop(c: Crop, w: number, h: number, ratio: number): Crop {
  const width = Math.min(c.width, w, h * ratio);
  const height = width / ratio;
  return {
    x: clamp(c.x + (c.width - width) / 2, 0, w - width),
    y: clamp(c.y + (c.height - height) / 2, 0, h - height),
    width,
    height,
  };
}

/** Snaps to whole pixels; null when the crop covers the whole image. */
export function finalizeCrop(c: Crop, w: number, h: number): Crop | null {
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  const width = Math.max(1, Math.min(Math.round(c.width), Math.floor(w) - x));
  const height = Math.max(1, Math.min(Math.round(c.height), Math.floor(h) - y));
  return x === 0 && y === 0 && width >= Math.floor(w) && height >= Math.floor(h) ? null : { x, y, width, height };
}
