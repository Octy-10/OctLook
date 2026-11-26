import { useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import { pageSize, renderPage } from "../lib/pdf";
import { SETTLE_MS } from "../lib/viewport";

export interface PdfPage {
  page: PDFPageProxy;
  width: number;
  height: number;
}

export function usePdfPage(doc: PDFDocumentProxy | null, pageNumber: number): PdfPage | null {
  const [page, setPage] = useState<PdfPage | null>(null);
  useEffect(() => {
    if (!doc) return setPage(null);
    let alive = true;
    doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages)).then((p) => {
      if (!alive) return;
      const [width, height] = pageSize(p);
      setPage({ page: p, width, height });
    });
    return () => {
      alive = false;
    };
  }, [doc, pageNumber]);
  return page;
}

/** Re-render threshold: resolution tiers at powers of two of device pixels. */
const tier = (scale: number) => Math.max(0.25, 2 ** Math.ceil(Math.log2(scale * devicePixelRatio)));

/**
 * Keeps `canvasRef` filled with a raster of `page` sharp enough for the
 * current zoom. Vector re-rendering happens off-screen and is swapped in,
 * so zooming never flashes an empty canvas.
 */
export function usePdfRaster(canvasRef: RefObject<HTMLCanvasElement | null>, page: PDFPageProxy | null, scale: number) {
  const level = tier(scale);
  const painted = useRef<PDFPageProxy | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;
    let job: ReturnType<typeof renderPage> | null = null;
    const start = () => {
      job = renderPage(page, level);
      job.done
        .then((off) => {
          canvas.width = off.width;
          canvas.height = off.height;
          canvas.getContext("2d")!.drawImage(off, 0, 0);
          painted.current = page;
        })
        .catch(() => {}); // cancelled by a newer render
    };
    // A new page paints at once; zoom tiers wait for the gesture to settle.
    const timer = painted.current !== page ? (start(), 0) : window.setTimeout(start, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      job?.cancel();
    };
  }, [canvasRef, page, level]);
}
