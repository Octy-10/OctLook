/**
 * The content currently on stage, published by its layer. Gives non-React
 * code (eyedropper, export, OCR) pixel access without prop drilling.
 */
import type { Orientation } from "./viewport";

export interface Raster {
  image: CanvasImageSource;
  /** Image pixels per content pixel. */
  scale: number;
}

export interface Surface {
  /** Content size in CSS px, before orientation. */
  width: number;
  height: number;
  orientation: Orientation;
  /** One RGBA pixel at content coordinates; null outside the content. */
  sample(x: number, y: number): Uint8ClampedArray | null;
  /** The whole content at export quality. */
  raster(): Raster | Promise<Raster>;
  /** Text embedded in vector documents; absent for raster content. */
  text?(): Promise<string>;
}

let current: Surface | null = null;

export const getSurface = () => current;

/** Publishes `surface`; the returned cleanup withdraws it. */
export function publishSurface(surface: Surface) {
  current = surface;
  return () => {
    if (current === surface) current = null;
  };
}

export function readPixel(canvas: HTMLCanvasElement, x: number, y: number, sx = 1, sy = 1) {
  const px = Math.floor(x * sx);
  const py = Math.floor(y * sy);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  return canvas.getContext("2d", { willReadFrequently: true })!.getImageData(px, py, 1, 1).data;
}
