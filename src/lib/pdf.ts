/**
 * Page geometry and rasterisation. Type-only imports keep pdf.js out of the
 * main bundle; the engine itself is loaded on demand by `pdf-open.ts`.
 */
import type { PDFPageProxy } from "pdfjs-dist";

import type { OpenedPdf } from "./pdf-open";

/** pdf.js renders 1 pt as 96/72 CSS px at "100 %", matching physical size. */
export const PDF_CSS_SCALE = 96 / 72;

/** Loads pdf.js on first use and opens `data`. */
export const openPdfLazy = (data: Uint8Array): Promise<OpenedPdf> =>
  import("./pdf-open").then((m) => m.openPdf(data));

/** Upper bound for one rendered page bitmap (≈ 8K²) to stay GPU friendly. */
const MAX_RENDER_PIXELS = 64_000_000;

export function pageSize(page: PDFPageProxy): [number, number] {
  const vp = page.getViewport({ scale: PDF_CSS_SCALE });
  return [vp.width, vp.height];
}

/**
 * Renders `page` at `zoom` (relative to its CSS size) into a fresh canvas.
 * The resolution is capped, so extreme zoom levels stay responsive.
 */
export function renderPage(page: PDFPageProxy, zoom: number) {
  const [w, h] = pageSize(page);
  const wanted = PDF_CSS_SCALE * zoom;
  const cap = Math.sqrt(MAX_RENDER_PIXELS / (w * h)) * PDF_CSS_SCALE;
  const viewport = page.getViewport({ scale: Math.min(wanted, cap) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const task = page.render({ canvas, viewport });
  return { canvas, done: task.promise.then(() => canvas), cancel: () => task.cancel() };
}
