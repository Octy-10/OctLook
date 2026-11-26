import { api, assetUrl, frameUrl, type Category } from "./ipc";
import { openPdfLazy, pageSize, renderPage } from "./pdf";
import { canvasUrl, fontThumb, textThumb, videoThumb } from "./thumbRender";

/** `url` is null when nothing could be drawn: the strip shows the category instead. */
export interface Thumbnail {
  url: string | null;
  category: Category;
}

const CAPACITY = 600;
/** path → thumbnail, kept in LRU order (Map preserves insertion order). */
const cache = new Map<string, Promise<Thumbnail>>();

const DRAWN: Partial<Record<Category, (path: string, size: number) => Promise<string>>> = {
  video: videoThumb,
  text: textThumb,
  font: fontThumb,
};

async function pdfThumb(path: string, size: number): Promise<string> {
  const { payload } = await api.decode(path);
  const { doc, destroy } = await openPdfLazy(payload);
  try {
    const page = await doc.getPage(1);
    return await canvasUrl(await renderPage(page, size / Math.max(...pageSize(page))).done);
  } finally {
    destroy();
  }
}

async function load(path: string, size: number): Promise<Thumbnail> {
  const frame = await api.thumbnail(path, size);
  const { kind, category } = frame.header;
  switch (kind) {
    case "native": {
      if (category === "image") return { url: assetUrl(path), category };
      const draw = DRAWN[category];
      return { url: draw ? await draw(path, size).catch(() => null) : null, category };
    }
    case "pdf":
      return { url: await pdfThumb(path, size), category };
    default:
      return { url: frameUrl(frame), category };
  }
}

const release = (thumb: Promise<Thumbnail>) =>
  thumb.then(({ url }) => url?.startsWith("blob:") && URL.revokeObjectURL(url), () => {});

export function getThumbnail(path: string, size: number): Promise<Thumbnail> {
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
