/**
 * Thumbnails the WebView draws itself, for files it already knows how to
 * show: a frame of a video, the first lines of a text file, a font specimen.
 */
import { loadFont } from "./font";
import { api, assetUrl } from "./ipc";

/** Thumbnails stand for documents: a paper page, whatever the UI theme. */
const PAPER = "#ffffff";
const INK = "#2c2c30";
const VIDEO_TIMEOUT = 10_000;

export async function canvasUrl(canvas: HTMLCanvasElement, type = "image/png"): Promise<string> {
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85));
  if (!blob) throw new Error("缩略图生成失败");
  return URL.createObjectURL(blob);
}

function page(width: number, height = width) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  return { canvas, ctx };
}

/** Runs at most `n` tasks at once; the rest wait their turn. */
function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < n) active++;
    else await new Promise<void>((go) => queue.push(go));
    try {
      return await task();
    } finally {
      // A finished task hands its slot straight to the next one.
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

function settle(video: HTMLVideoElement, event: string) {
  return new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("视频解码超时")), VIDEO_TIMEOUT);
    const done = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      if (error) fail(error);
      else ok();
    };
    const onEvent = () => done();
    const onError = () => done(new Error("无法解码此视频"));
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

/** Video decoders are heavy: a strip of them decodes two at a time. */
const videoSlot = limiter(2);

export const videoThumb = (path: string, size: number) =>
  videoSlot(async () => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous"; // keeps the canvas exportable
    video.src = assetUrl(path);
    try {
      await settle(video, "loadeddata");
      if (!video.videoWidth) throw new Error("没有画面");
      // A frame a little in: the very first one is often black.
      video.currentTime = Math.min(1, video.duration / 10 || 0);
      await settle(video, "seeked");
      const scale = Math.min(1, size / Math.max(video.videoWidth, video.videoHeight));
      const { canvas, ctx } = page(video.videoWidth * scale, video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return await canvasUrl(canvas, "image/jpeg");
    } finally {
      video.removeAttribute("src");
      video.load();
    }
  });

/** The file's opening lines on a page, like a document icon that shows its content. */
export async function textThumb(path: string, size: number): Promise<string> {
  const { text } = await api.readText(path, 4096);
  const { canvas, ctx } = page(size);
  const pad = size * 0.09;
  const fontSize = size / 12;
  const lineHeight = fontSize * 1.45;
  ctx.font = `${fontSize}px Consolas, "Microsoft YaHei", "PingFang SC", monospace`;
  ctx.textBaseline = "top";
  ctx.rect(pad, pad, size - pad * 2, size - pad * 2);
  ctx.clip();
  const lines = text.replace(/\t/g, "  ").split(/\r?\n/);
  for (let i = 0, y = pad; i < lines.length && y < size - pad; i++, y += lineHeight) ctx.fillText(lines[i], pad, y);
  return canvasUrl(canvas);
}

/** "Aa" set in the font itself, plus a Chinese glyph when it has them. */
export async function fontThumb(path: string, size: number): Promise<string> {
  const font = await loadFont(path);
  try {
    const { canvas, ctx } = page(size);
    const cjk = font.info?.cjk;
    ctx.font = `${size * (cjk ? 0.34 : 0.46)}px "${font.family}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cjk ? "Aa永" : "Aa", size / 2, size / 2);
    return await canvasUrl(canvas);
  } finally {
    font.release();
  }
}
