/**
 * Pure viewport math. The content element is centred in the stage, then
 * (right-to-left) mirrored by EXIF, rotated, scaled/flipped by the user and
 * finally translated by the pan offset.
 */

export interface View {
  scale: number;
  /** Pan offset of the content centre from the stage centre, in CSS px. */
  x: number;
  y: number;
  /** User rotation in degrees: 0 | 90 | 180 | 270. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  /** While true the view tracks "fit to window" across resizes. */
  fit: boolean;
}

export interface Orientation {
  rotation: number;
  mirror: boolean;
}

/** EXIF orientation tag → rotation applied after a horizontal mirror. */
const EXIF: Record<number, Orientation> = {
  1: { rotation: 0, mirror: false },
  2: { rotation: 0, mirror: true },
  3: { rotation: 180, mirror: false },
  4: { rotation: 180, mirror: true },
  5: { rotation: 270, mirror: true },
  6: { rotation: 90, mirror: false },
  7: { rotation: 90, mirror: true },
  8: { rotation: 270, mirror: false },
};

export const exifOrientation = (tag: number) => EXIF[tag] ?? EXIF[1];

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 64;
const STEPS = [0.02, 0.05, 0.1, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const FIT_MARGIN = 32;

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const initialView = (): View => ({ scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, fit: true });

const totalRotation = (view: View, o: Orientation) => (view.rotation + o.rotation) % 360;

/** On-screen bounding box of the content at scale 1. */
export function rotatedSize(w: number, h: number, view: View, o: Orientation): [number, number] {
  return totalRotation(view, o) % 180 === 0 ? [w, h] : [h, w];
}

/** Largest scale that fits the stage, never enlarging past 100 %. */
export function fitScale(w: number, h: number, view: View, o: Orientation, stageW: number, stageH: number) {
  const [bw, bh] = rotatedSize(w, h, view, o);
  const s = Math.min((stageW - FIT_MARGIN * 2) / bw, (stageH - FIT_MARGIN * 2) / bh, 1);
  return clampScale(s > 0 ? s : 1);
}

export function cssTransform(view: View, o: Orientation): string {
  const sx = view.scale * (view.flipX ? -1 : 1);
  const sy = view.scale * (view.flipY ? -1 : 1);
  return (
    `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) ` +
    `scale(${sx}, ${sy}) rotate(${totalRotation(view, o)}deg) scale(${o.mirror ? -1 : 1}, 1)`
  );
}

/** Zooms keeping the stage point (px, py) — relative to the stage centre — fixed. */
export function zoomAt(view: View, scale: number, px: number, py: number): View {
  const next = clampScale(scale);
  const k = next / view.scale;
  return { ...view, scale: next, x: px - (px - view.x) * k, y: py - (py - view.y) * k, fit: false };
}

export function stepScale(scale: number, direction: 1 | -1): number {
  const eps = 1e-6;
  const found = direction > 0 ? STEPS.find((s) => s > scale + eps) : [...STEPS].reverse().find((s) => s < scale - eps);
  return found ?? (direction > 0 ? MAX_SCALE : MIN_SCALE);
}

/** Maps a stage point (relative to the stage centre) to content pixel coordinates. */
export function stageToContent(view: View, o: Orientation, w: number, h: number, px: number, py: number): [number, number] {
  let dx = (px - view.x) / (view.scale * (view.flipX ? -1 : 1));
  let dy = (py - view.y) / (view.scale * (view.flipY ? -1 : 1));
  const r = (totalRotation(view, o) * Math.PI) / 180;
  const cos = Math.round(Math.cos(r));
  const sin = Math.round(Math.sin(r));
  [dx, dy] = [dx * cos + dy * sin, -dx * sin + dy * cos];
  if (o.mirror) dx = -dx;
  return [dx + w / 2, dy + h / 2];
}
