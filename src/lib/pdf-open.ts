import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Runtime assets copied by `scripts/copy-pdfjs-assets.mjs`. */
const ASSETS = "/pdfjs/";

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Tears down the document and its worker-side resources. */
  destroy(): void;
}

export async function openPdf(data: Uint8Array): Promise<OpenedPdf> {
  const task = getDocument({
    data,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    iccUrl: `${ASSETS}iccs/`,
    wasmUrl: `${ASSETS}wasm/`,
  });
  return { doc: await task.promise, destroy: () => void task.destroy() };
}
