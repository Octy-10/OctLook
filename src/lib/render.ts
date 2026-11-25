/** Flattens the staged content with every edit applied (crop, rotation, flips, colour, annotations). */
import { useEditState, type ExportFormat } from "../store/edit";
import { useViewState } from "../store/view";
import { drawAnnotations } from "./annotate";
import { fullCrop } from "./crop";
import { applyColorMatrix, colorMatrix, isNeutral } from "./edits";
import { getSurface } from "./surface";

/** Chromium's canvas limits (see `fit_texture_limits` in the decoder). */
const MAX_EDGE = 32_767;
const MAX_AREA = 268_435_456;

export interface RenderOptions {
  /** Longest output edge in px; null keeps the source resolution. */
  maxEdge?: number | null;
  /** Painted behind transparent pixels (formats without alpha). */
  background?: string;
}

export async function renderEdited({ maxEdge = null, background }: RenderOptions = {}): Promise<HTMLCanvasElement> {
  const surface = getSurface();
  if (!surface) throw new Error("当前没有可处理的图像");
  const { adjust, crop, annotations } = useEditState.getState();
  const { rotation, flipX, flipY } = useViewState.getState().view;
  const { image, scale } = await surface.raster();

  const box = crop ?? fullCrop(surface.width, surface.height);
  const turn = (rotation + surface.orientation.rotation) % 360;
  const [w, h] = turn % 180 === 0 ? [box.width, box.height] : [box.height, box.width];
  const limit = Math.min(maxEdge ?? MAX_EDGE, MAX_EDGE);
  const k = Math.min(scale, limit / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext("2d")!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = "high";
  // Same order as `cssTransform`: flips, rotation, then the EXIF mirror.
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(k * (flipX ? -1 : 1), k * (flipY ? -1 : 1));
  ctx.rotate((turn * Math.PI) / 180);
  ctx.scale(surface.orientation.mirror ? -1 : 1, 1);
  // The canvas bounds do the cropping, so vector images need no source rect.
  ctx.drawImage(image, -box.x - box.width / 2, -box.y - box.height / 2, surface.width, surface.height);

  if (!isNeutral(adjust)) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyColorMatrix(pixels.data, colorMatrix(adjust));
    ctx.putImageData(pixels, 0, 0);
  }
  // Annotations keep their own colours: drawn after the colour pass, in content space.
  ctx.translate(-box.x - box.width / 2, -box.y - box.height / 2);
  drawAnnotations(ctx, annotations);
  return canvas;
}

export const EXPORT_FORMATS: Record<ExportFormat, { label: string; extension: string; lossy: boolean }> = {
  png: { label: "PNG", extension: "png", lossy: false },
  jpeg: { label: "JPG", extension: "jpg", lossy: true },
  webp: { label: "WebP", extension: "webp", lossy: true },
};

export function encodeCanvas(canvas: HTMLCanvasElement, format: ExportFormat = "png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图像编码失败"))), `image/${format}`, quality),
  );
}
