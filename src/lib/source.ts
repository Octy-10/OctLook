import type { PDFDocumentProxy } from "pdfjs-dist";

import { api, assetUrl, type DecodeMeta, type Frame } from "./ipc";
import { openPdfLazy } from "./pdf";

interface Common {
  meta: DecodeMeta;
  dispose(): void;
}

/** A file ready to be put on stage. */
export type ImageSource =
  | (Common & { kind: "image"; url: string; width: number; height: number })
  | (Common & { kind: "vector"; image: HTMLImageElement; width: number; height: number })
  | (Common & { kind: "bitmap"; bitmap: ImageBitmap; width: number; height: number })
  | (Common & { kind: "pdf"; doc: PDFDocumentProxy; pages: number });

const metaOf = ({ header: { kind: _k, mime: _m, width: _w, height: _h, ...meta } }: Frame): DecodeMeta => meta;

async function decodedImage(url: string, meta: DecodeMeta, dispose: () => void): Promise<ImageSource> {
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous"; // keeps canvases readable for the colour picker
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    dispose();
    throw new Error("WebView 无法解码此图像", { cause: e });
  }
  // Vector images without intrinsic size report 0 × 0.
  const width = img.naturalWidth || 1024;
  const height = img.naturalHeight || 1024;
  // SVG is drawn by the stage itself: as an <img> the WebView re-rasterises the whole vector at every zoom step.
  return meta.format === "SVG"
    ? { kind: "vector", image: img, width, height, meta, dispose }
    : { kind: "image", url, width, height, meta, dispose };
}

async function load(path: string): Promise<ImageSource> {
  const frame = await api.decode(path);
  const { header, payload } = frame;
  const meta = metaOf(frame);
  switch (header.kind) {
    case "native":
      return decodedImage(assetUrl(path), meta, () => {});
    case "encoded": {
      const url = URL.createObjectURL(new Blob([payload], { type: header.mime ?? "" }));
      return decodedImage(url, meta, () => URL.revokeObjectURL(url));
    }
    case "pixels": {
      const { width, height } = header as { width: number; height: number };
      const data = new Uint8ClampedArray(payload.buffer, payload.byteOffset, payload.byteLength);
      const bitmap = await createImageBitmap(new ImageData(data, width, height));
      return { kind: "bitmap", bitmap, width, height, meta, dispose: () => bitmap.close() };
    }
    case "pdf": {
      const { doc, destroy } = await openPdfLazy(payload);
      return { kind: "pdf", doc, pages: doc.numPages, meta, dispose: destroy };
    }
  }
}

/** Decoded sources for the current file and its neighbours. */
const cache = new Map<string, Promise<ImageSource>>();

export function getSource(path: string): Promise<ImageSource> {
  let pending = cache.get(path);
  if (!pending) {
    pending = load(path);
    cache.set(path, pending);
    pending.catch(() => cache.delete(path));
  }
  return pending;
}

/** Releases every cached source not listed in `keep`. */
export function retainSources(keep: ReadonlySet<string>) {
  for (const [path, pending] of cache) {
    if (keep.has(path)) continue;
    cache.delete(path);
    pending.then((s) => s.dispose(), () => {});
  }
}
