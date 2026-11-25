import { useEffect, useRef, type CSSProperties } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import { readPixel, type Sampler } from "../../hooks/useColorProbe";
import { usePdfRaster } from "../../hooks/usePdfPage";
import type { ImageSource } from "../../lib/source";

interface LayerProps {
  style: CSSProperties;
  registerSampler(s: Sampler | null): void;
}

type Of<K extends ImageSource["kind"]> = Extract<ImageSource, { kind: K }>;

export function ImageLayer({ source, style, registerSampler }: LayerProps & { source: Of<"image"> }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Rasterised lazily: only the eyedropper ever needs pixel access.
    let canvas: HTMLCanvasElement | null = null;
    registerSampler((x, y) => {
      const img = ref.current;
      if (!img) return null;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0, source.width, source.height);
      }
      return readPixel(canvas, x, y);
    });
    return () => registerSampler(null);
  }, [source, registerSampler]);

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

export function BitmapLayer({ source, style, registerSampler }: LayerProps & { source: Of<"bitmap"> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")!.drawImage(source.bitmap, 0, 0);
    registerSampler((x, y) => readPixel(canvas, x, y));
    return () => registerSampler(null);
  }, [source, registerSampler]);
  return <canvas ref={ref} style={style} />;
}

interface PdfLayerProps extends LayerProps {
  page: PDFPageProxy;
  width: number;
  height: number;
  scale: number;
}

export function PdfLayer({ page, width, height, scale, style, registerSampler }: PdfLayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  usePdfRaster(ref, page, scale);
  useEffect(() => {
    const canvas = ref.current!;
    registerSampler((x, y) => readPixel(canvas, x, y, canvas.width / width, canvas.height / height));
    return () => registerSampler(null);
  }, [width, height, registerSampler]);
  return <canvas ref={ref} width={1} height={1} style={{ ...style, background: "#fff" }} />;
}
