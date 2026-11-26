import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import { usePdfRaster } from "../../hooks/usePdfPage";
import { renderPage } from "../../lib/pdf";
import type { ImageSource } from "../../lib/source";
import { publishSurface, readPixel, type Surface } from "../../lib/surface";
import { exifOrientation, SETTLE_MS, type Rect } from "../../lib/viewport";

interface LayerProps {
  style: CSSProperties;
  /** The primary layer publishes itself as the stage surface; comparison copies do not. */
  primary: boolean;
}

type Of<K extends ImageSource["kind"]> = Extract<ImageSource, { kind: K }>;

/** Vector pages are exported at 300 DPI (pdf.js lays out 1 pt as 96/72 px). */
const PDF_EXPORT_ZOOM = 300 / 96;

/** Device pixels of a vector's whole-image raster, shown where the view moves past the sharp part (≈ 2K²). */
const VECTOR_BASE_PIXELS = 4_000_000;
/** Longest canvas edge every GPU takes. */
const MAX_CANVAS_EDGE = 8192;

/** The stage surface over a decoded image, rasterised lazily: only the eyedropper ever needs pixel access. */
function imageSurface(img: HTMLImageElement, source: Of<"image" | "vector">): Surface {
  let canvas: HTMLCanvasElement | null = null;
  return {
    width: source.width,
    height: source.height,
    orientation: exifOrientation(source.meta.orientation),
    sample(x, y) {
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0, source.width, source.height);
      }
      return readPixel(canvas, x, y);
    },
    raster: () => ({ image: img, scale: 1 }),
  };
}

export function ImageLayer({ source, style, primary }: LayerProps & { source: Of<"image"> }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => (primary ? publishSurface(imageSurface(ref.current!, source)) : undefined), [source, primary]);

  const orientation = source.meta.orientation === 1 ? undefined : "none"; // applied by the stage transform
  return (
    <img
      ref={ref}
      src={source.url}
      crossOrigin="anonymous"
      alt=""
      draggable={false}
      style={{ ...style, imageOrientation: orientation }}
    />
  );
}

interface VectorLayerProps extends LayerProps {
  source: Of<"vector">;
  /** The part on screen, in source px. */
  visible: Rect | null;
  scale: number;
  /** A fitted view changes in single steps (new image, resize, rotation), never mid-gesture. */
  fit: boolean;
}

const NOTHING: Rect = { x: 0, y: 0, width: 0, height: 0 };
const PLACED: CSSProperties = { position: "absolute" };

/**
 * SVG on two canvases the compositor only moves and scales: a whole-image
 * raster, and on top of it the visible part at exactly device resolution,
 * redrawn once the view settles. Sharp at any zoom, bounded in memory, and
 * no vector re-rasterisation while zooming or panning.
 */
export function VectorLayer({ source, style, primary, visible, scale, fit }: VectorLayerProps) {
  const base = useRef<HTMLCanvasElement>(null);
  const sharp = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const { width, height } = source;
    const zoom = Math.min(Math.sqrt(VECTOR_BASE_PIXELS / (width * height)), MAX_CANVAS_EDGE / Math.max(width, height));
    paint(base.current!, source, { x: 0, y: 0, width, height }, zoom);
    sharp.current!.width = 0; // still the previous image's
  }, [source]);
  useEffect(() => (primary ? publishSurface(imageSurface(source.image, source)) : undefined), [source, primary]);

  const { x, y, width, height } = visible ?? NOTHING;
  const zoom = scale * devicePixelRatio;
  useLayoutEffect(() => {
    if (!width || !height) return;
    const draw = () => paint(sharp.current!, source, { x, y, width, height }, zoom);
    if (fit) return draw();
    const timer = window.setTimeout(draw, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [source, x, y, width, height, zoom, fit]);

  return (
    <div style={style}>
      <canvas ref={base} style={PLACED} />
      <canvas ref={sharp} style={PLACED} />
    </div>
  );
}

/** Draws `rect` of the image into `canvas` at `zoom` canvas px per source px, and lays the canvas over that rect. */
function paint(canvas: HTMLCanvasElement, { image, width, height }: Of<"vector">, rect: Rect, zoom: number) {
  // Snapped to whole canvas pixels, so at rest each one lands on a device pixel.
  const left = Math.floor(rect.x * zoom);
  const top = Math.floor(rect.y * zoom);
  canvas.width = Math.ceil((rect.x + rect.width) * zoom) - left;
  canvas.height = Math.ceil((rect.y + rect.height) * zoom) - top;
  canvas.getContext("2d")!.drawImage(image, -left, -top, width * zoom, height * zoom);
  Object.assign(canvas.style, {
    left: `${left / zoom}px`,
    top: `${top / zoom}px`,
    width: `${canvas.width / zoom}px`,
    height: `${canvas.height / zoom}px`,
  });
}

export function BitmapLayer({ source, style, primary }: LayerProps & { source: Of<"bitmap"> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")!.drawImage(source.bitmap, 0, 0);
    if (!primary) return;
    return publishSurface({
      width: source.width,
      height: source.height,
      orientation: exifOrientation(source.meta.orientation),
      sample: (x, y) => readPixel(canvas, x, y),
      raster: () => ({ image: source.bitmap, scale: 1 }),
    });
  }, [source, primary]);
  return <canvas ref={ref} style={style} />;
}

interface PdfLayerProps extends LayerProps {
  page: PDFPageProxy;
  width: number;
  height: number;
  scale: number;
}

export function PdfLayer({ page, width, height, scale, style, primary }: PdfLayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  usePdfRaster(ref, page, scale);
  useEffect(() => {
    if (!primary) return;
    const canvas = ref.current!;
    return publishSurface({
      width,
      height,
      orientation: exifOrientation(1),
      sample: (x, y) => readPixel(canvas, x, y, canvas.width / width, canvas.height / height),
      async raster() {
        const image = await renderPage(page, PDF_EXPORT_ZOOM).done;
        return { image, scale: image.width / width };
      },
      async text() {
        const { items } = await page.getTextContent();
        return items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
      },
    });
  }, [page, width, height, primary]);
  return <canvas ref={ref} width={1} height={1} style={{ ...style, background: "#fff" }} />;
}
