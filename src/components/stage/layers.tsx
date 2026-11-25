import { useEffect, useRef, type CSSProperties } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import { usePdfRaster } from "../../hooks/usePdfPage";
import { renderPage } from "../../lib/pdf";
import type { ImageSource } from "../../lib/source";
import { publishSurface, readPixel } from "../../lib/surface";
import { exifOrientation } from "../../lib/viewport";

interface LayerProps {
  style: CSSProperties;
  /** The primary layer publishes itself as the stage surface; comparison copies do not. */
  primary: boolean;
}

type Of<K extends ImageSource["kind"]> = Extract<ImageSource, { kind: K }>;

/** Vector pages are exported at 300 DPI (pdf.js lays out 1 pt as 96/72 px). */
const PDF_EXPORT_ZOOM = 300 / 96;

export function ImageLayer({ source, style, primary }: LayerProps & { source: Of<"image"> }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!primary) return;
    const img = ref.current!;
    // Rasterised lazily: only the eyedropper ever needs pixel access.
    let canvas: HTMLCanvasElement | null = null;
    return publishSurface({
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
    });
  }, [source, primary]);

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
