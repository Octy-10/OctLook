/**
 * Annotations drawn on top of the image, in content pixels. The SVG overlay
 * and the exporter share the geometry and styling defined here.
 */
import type { Orientation, View } from "./viewport";

export type Tool = "text" | "arrow" | "rect" | "pen";
export type Point = [x: number, y: number];

/** Counter-transform keeping text upright on screen for the view it was placed in. */
export interface Upright {
  mirror: 1 | -1;
  /** Degrees the content was turned on screen. */
  turn: number;
  flipX: 1 | -1;
  flipY: 1 | -1;
}

interface Base {
  id: string;
  color: string;
}

export type TextAnnotation = Base & { kind: "text"; x: number; y: number; text: string; size: number; upright: Upright };
export type PenAnnotation = Base & { kind: "pen"; points: Point[]; stroke: number };
export type Annotation =
  | TextAnnotation
  | PenAnnotation
  | (Base & { kind: "rect"; x: number; y: number; width: number; height: number; stroke: number })
  | (Base & { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; stroke: number });

export const INK_COLORS = ["#FF453A", "#FF9F0A", "#30D158", "#0A84FF", "#FFFFFF", "#111113"];

/** Style given to new annotations. Scales are relative to the image size, so they carry across images. */
export interface Ink {
  color: string;
  textScale: number;
  strokeScale: number;
}

type ScaleKey = "textScale" | "strokeScale";
const STROKE = { key: "strokeScale", divisor: 260, range: [0.25, 6] } as const;
/** Which ink scale a kind of annotation is sized by, its slider range and the px size at scale 1. */
const SIZING: Record<Annotation["kind"], { key: ScaleKey; divisor: number; range: readonly [number, number] }> = {
  text: { key: "textScale", divisor: 28, range: [0.25, 5] },
  arrow: STROKE,
  rect: STROKE,
  pen: STROKE,
};
export const sizing = (kind: Annotation["kind"]) => SIZING[kind];

/** Size in px (font size or stroke width) of `kind` at `scale`, for an image whose longest edge is `unit`. */
export const sizeAt = (kind: Annotation["kind"], unit: number, scale: number) => (unit / SIZING[kind].divisor) * scale;
export const sizeOf = (a: Annotation) => (a.kind === "text" ? a.size : a.stroke);
const withSize = (a: Annotation, size: number): Annotation => (a.kind === "text" ? { ...a, size } : { ...a, stroke: size });

/** Applies `ink` to an existing annotation. */
export const restyle = (a: Annotation, ink: Ink, unit: number) =>
  withSize({ ...a, color: ink.color }, sizeAt(a.kind, unit, ink[SIZING[a.kind].key]));

const FONT_FAMILY = '"Segoe UI Variable Text", "Microsoft YaHei UI", "PingFang SC", sans-serif';
export const fontOf = (size: number) => `600 ${size}px ${FONT_FAMILY}`;

let probe: OffscreenCanvasRenderingContext2D | null = null;

/** Advance width and font ascent / descent of `text` at `size`. */
export function measureText(text: string, size: number) {
  probe ??= new OffscreenCanvas(1, 1).getContext("2d")!;
  probe.font = fontOf(size);
  const m = probe.measureText(text);
  return { width: m.width, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
}

/** Inverse of the linear part of `cssTransform`. */
export const uprightFor = (view: View, o: Orientation): Upright => ({
  mirror: o.mirror ? -1 : 1,
  turn: (view.rotation + o.rotation) % 360,
  flipX: view.flipX ? -1 : 1,
  flipY: view.flipY ? -1 : 1,
});

/** The same transform as CSS / SVG syntax, applied after translating to the text origin. */
export const uprightTransform = (u: Upright, unit: "" | "deg") =>
  `scale(${u.mirror}, 1) rotate(${-u.turn}${unit}) scale(${u.flipX}, ${u.flipY})`;

/** Text-local vector → content-space vector. */
function fromLocal(u: Upright, x: number, y: number): Point {
  const angle = (-u.turn * Math.PI) / 180;
  const [lx, ly] = [x * u.flipX, y * u.flipY];
  return [(lx * Math.cos(angle) - ly * Math.sin(angle)) * u.mirror, lx * Math.sin(angle) + ly * Math.cos(angle)];
}

/** Corners of a text's box relative to its baseline origin, unrotated: top-left, top-right, bottom-right, bottom-left. */
function localCorners(a: TextAnnotation): Point[] {
  const { width, ascent, descent } = measureText(a.text, a.size);
  return [[0, -ascent], [width, -ascent], [width, descent], [0, descent]];
}

/** The same corners in content space. */
export function textCorners(a: TextAnnotation): Point[] {
  return localCorners(a).map(([x, y]) => {
    const [dx, dy] = fromLocal(a.upright, x, y);
    return [a.x + dx, a.y + dy];
  });
}

/** Bounding box of a freehand stroke, clockwise from top-left. */
export function penCorners(points: Point[]): Point[] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * A draggable part of an annotation. `anchor` stays put while it moves; an
 * edge handle (`axis`) resizes in one direction only and covers `span`.
 */
export interface Handle {
  key: string;
  x: number;
  y: number;
  anchor: Point;
  axis?: "x" | "y";
  span?: [Point, Point];
}

/** Handles on `corners` (in cyclic order), each anchored at the opposite corner. */
const cornerHandles = (corners: Point[]): Handle[] =>
  corners.map(([x, y], i) => ({ key: `corner${i}`, x, y, anchor: corners[(i + 2) % 4] }));

export function handlesOf(a: Annotation): Handle[] {
  if (a.kind === "arrow") {
    return [
      { key: "start", x: a.x1, y: a.y1, anchor: [a.x2, a.y2] },
      { key: "end", x: a.x2, y: a.y2, anchor: [a.x1, a.y1] },
    ];
  }
  if (a.kind === "text") return cornerHandles(textCorners(a));
  if (a.kind === "pen") return [];
  const [x0, y0, x1, y1] = [a.x, a.y, a.x + a.width, a.y + a.height];
  // Edges come first so that, where they meet, the corners on top win the hit test.
  const edges: Handle[] = [
    { key: "top", x: (x0 + x1) / 2, y: y0, anchor: [x0, y1], axis: "y", span: [[x0, y0], [x1, y0]] },
    { key: "right", x: x1, y: (y0 + y1) / 2, anchor: [x0, y0], axis: "x", span: [[x1, y0], [x1, y1]] },
    { key: "bottom", x: (x0 + x1) / 2, y: y1, anchor: [x0, y0], axis: "y", span: [[x0, y1], [x1, y1]] },
    { key: "left", x: x0, y: (y0 + y1) / 2, anchor: [x1, y0], axis: "x", span: [[x0, y0], [x0, y1]] },
  ];
  // Bottom-right last: a new rectangle is drawn by dragging it.
  return [...edges, ...cornerHandles([[x0, y1], [x0, y0], [x1, y0], [x1, y1]])];
}

const MIN_TEXT_SIZE = 4;
/** Start and length of the interval between `a` and `b`. */
const extent = (a: number, b: number): Point => [Math.min(a, b), Math.abs(b - a)];

/** `origin` (the annotation when the drag began) with `handle` dragged to (x, y). */
export function dragHandle(origin: Annotation, handle: Handle, x: number, y: number): Annotation {
  const [ax, ay] = handle.anchor;
  if (origin.kind === "arrow") return handle.key === "start" ? { ...origin, x1: x, y1: y } : { ...origin, x2: x, y2: y };
  if (origin.kind === "pen") return origin;
  if (origin.kind === "rect") {
    const [nx, width] = handle.axis === "y" ? [origin.x, origin.width] : extent(ax, x);
    const [ny, height] = handle.axis === "x" ? [origin.y, origin.height] : extent(ay, y);
    return { ...origin, x: nx, y: ny, width, height };
  }
  // Text scales with the pointer's distance from the opposite corner, which stays fixed.
  const factor = Math.hypot(x - ax, y - ay) / (Math.hypot(handle.x - ax, handle.y - ay) || 1);
  const size = Math.max(MIN_TEXT_SIZE, origin.size * factor);
  const ratio = size / origin.size; // every text metric is proportional to the font size
  const [lx, ly] = localCorners(origin)[(Number(handle.key.slice(-1)) + 2) % 4];
  const [dx, dy] = fromLocal(origin.upright, lx * ratio, ly * ratio);
  return { ...origin, size, x: ax - dx, y: ay - dy };
}

export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.kind === "arrow") return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.kind === "pen") return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy]) };
  return { ...a, x: a.x + dx, y: a.y + dy };
}

/** Shaft end and right-angled head of an arrow pointing at (x2, y2). */
export function arrowShape(a: Extract<Annotation, { kind: "arrow" }>) {
  const length = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) || 1;
  const [ux, uy] = [(a.x2 - a.x1) / length, (a.y2 - a.y1) / length];
  const head = Math.min(a.stroke * 3.2, length);
  // A 90° tip: half the base is as long as the head.
  const [bx, by] = [a.x2 - ux * head, a.y2 - uy * head];
  return {
    // The flat-ended shaft stops inside the head, so no seam shows at its base.
    shaftEnd: [a.x2 - (ux * head) / 2, a.y2 - (uy * head) / 2] as const,
    head: [[a.x2, a.y2], [bx - uy * head, by + ux * head], [bx + uy * head, by - ux * head]] as Point[],
  };
}

/** Smooth path through freehand `points`: quadratic curves between successive midpoints. */
export function penPath(points: Point[]) {
  const [[x0, y0], ...rest] = points;
  let d = `M${x0} ${y0}`;
  if (!rest.length) return `${d}l0 0`; // a dot, drawn by the round cap
  for (let i = 0; i < rest.length - 1; i++) {
    const [[x, y], [nx, ny]] = [rest[i], rest[i + 1]];
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const [lx, ly] = rest[rest.length - 1];
  return `${d}L${lx} ${ly}`;
}

/** Paints `list` onto a context whose user space is content pixels. */
export function drawAnnotations(ctx: CanvasRenderingContext2D, list: Annotation[]) {
  for (const a of list) {
    ctx.fillStyle = ctx.strokeStyle = a.color;
    ctx.lineJoin = "round";
    if (a.kind === "rect") {
      ctx.lineWidth = a.stroke;
      ctx.strokeRect(a.x, a.y, a.width, a.height);
    } else if (a.kind === "pen") {
      ctx.lineWidth = a.stroke;
      ctx.lineCap = "round";
      ctx.stroke(new Path2D(penPath(a.points)));
    } else if (a.kind === "arrow") {
      const { shaftEnd, head } = arrowShape(a);
      ctx.lineWidth = a.stroke;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(...shaftEnd);
      ctx.stroke();
      ctx.beginPath();
      head.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.scale(a.upright.mirror, 1);
      ctx.rotate((-a.upright.turn * Math.PI) / 180);
      ctx.scale(a.upright.flipX, a.upright.flipY);
      ctx.font = fontOf(a.size);
      ctx.fillText(a.text, 0, 0);
      ctx.restore();
    }
  }
}
