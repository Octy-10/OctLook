/** Dominant colours by median cut over a small downsample. */
import { toHex } from "./format";
import type { ImageSource } from "./source";

const SAMPLE_EDGE = 64;

type Pixel = [number, number, number];

function widestChannel(bucket: Pixel[]): [channel: number, range: number] {
  let best: [number, number] = [0, -1];
  for (let c = 0; c < 3; c++) {
    let lo = 255;
    let hi = 0;
    for (const p of bucket) {
      if (p[c] < lo) lo = p[c];
      if (p[c] > hi) hi = p[c];
    }
    if (hi - lo > best[1]) best = [c, hi - lo];
  }
  return best;
}

function medianCut(pixels: Pixel[], count: number): string[] {
  const buckets = [pixels];
  while (buckets.length < count) {
    // Split the bucket spanning the widest colour range.
    let pick = -1;
    let channel = 0;
    let widest = 0;
    buckets.forEach((b, i) => {
      const [c, range] = widestChannel(b);
      if (b.length > 1 && range > widest) [pick, channel, widest] = [i, c, range];
    });
    if (pick < 0) break;
    const bucket = buckets[pick].sort((a, b) => a[channel] - b[channel]);
    buckets.splice(pick, 1, bucket.slice(0, bucket.length >> 1), bucket.slice(bucket.length >> 1));
  }
  const colors = buckets
    .sort((a, b) => b.length - a.length)
    .map((b) => toHex(...([0, 1, 2].map((c) => Math.round(b.reduce((sum, p) => sum + p[c], 0) / b.length)) as Pixel)));
  return [...new Set(colors)];
}

async function drawable(source: ImageSource): Promise<CanvasImageSource | null> {
  if (source.kind === "bitmap") return source.bitmap;
  if (source.kind !== "image") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = source.url;
  await img.decode(); // already in the WebView's decode cache
  return img;
}

/** Up to `count` HEX colours, most dominant first; empty for vector documents. */
export async function extractPalette(source: ImageSource, count = 6): Promise<string[]> {
  const image = await drawable(source);
  if (!image) return [];
  const canvas = new OffscreenCanvas(SAMPLE_EDGE, SAMPLE_EDGE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
  const { data } = ctx.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
  const pixels: Pixel[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 128) pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  return pixels.length ? medianCut(pixels, count) : [];
}
