import { api, assetUrl } from "./ipc";
import { openPdfLazy, pageSize, renderPage } from "./pdf";

const CAPACITY = 600;
/** path → object/asset URL, kept in LRU order (Map preserves insertion order). */
const cache = new Map<string, Promise<string>>();

async function pdfThumb(path: string, size: number): Promise<string> {
  const { payload } = await api.decode(path);
  const { doc, destroy } = await openPdfLazy(payload);
  try {
    const page = await doc.getPage(1);
    const canvas = await renderPage(page, size / Math.max(...pageSize(page))).done;
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("PDF 缩略图生成失败");
    return URL.createObjectURL(blob);
  } finally {
    destroy();
  }
}

async function load(path: string, size: number): Promise<string> {
  const { header, payload } = await api.thumbnail(path, size);
  switch (header.kind) {
    case "native":
      return assetUrl(path);
    case "pdf":
      return pdfThumb(path, size);
    default:
      return URL.createObjectURL(new Blob([payload], { type: header.mime ?? "image/png" }));
  }
}

const release = (url: Promise<string>) => url.then((u) => u.startsWith("blob:") && URL.revokeObjectURL(u), () => {});

export function getThumbnail(path: string, size: number): Promise<string> {
  const hit = cache.get(path);
  if (hit) {
    cache.delete(path);
    cache.set(path, hit);
    return hit;
  }
  const pending = load(path, size);
  cache.set(path, pending);
  pending.catch(() => cache.delete(path));
  if (cache.size > CAPACITY) {
    const [oldest, url] = cache.entries().next().value!;
    cache.delete(oldest);
    void release(url);
  }
  return pending;
}

export function forgetThumbnail(path: string) {
  const url = cache.get(path);
  if (url) {
    cache.delete(path);
    void release(url);
  }
}
