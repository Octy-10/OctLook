import { useCallback, useRef, useState, type PointerEvent, type RefObject } from "react";

import { stageToContent } from "../lib/viewport";
import { toast } from "../store/toast";
import { useViewState } from "../store/view";
import { centreOffset, type StageContent } from "./useViewport";

/** Reads one RGBA pixel at content coordinates; null outside the content. */
export type Sampler = (x: number, y: number) => Uint8ClampedArray | null;

export interface Probe {
  clientX: number;
  clientY: number;
  hex: string;
  rgba: [number, number, number, number];
}

export function readPixel(canvas: HTMLCanvasElement, x: number, y: number, sx = 1, sy = 1) {
  const px = Math.floor(x * sx);
  const py = Math.floor(y * sy);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  return canvas.getContext("2d", { willReadFrequently: true })!.getImageData(px, py, 1, 1).data;
}

const hex = (rgba: ArrayLike<number>) =>
  "#" + [rgba[0], rgba[1], rgba[2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/** Eyedropper: live colour under the cursor, click copies its HEX. */
export function useColorProbe(
  enabled: boolean,
  stageRef: RefObject<HTMLElement | null>,
  content: StageContent | null,
) {
  const view = useViewState((s) => s.view);
  const sampler = useRef<Sampler | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const sample = useCallback(
    (clientX: number, clientY: number): Probe | null => {
      const el = stageRef.current;
      if (!enabled || !el || !content || !sampler.current) return null;
      const [px, py] = centreOffset(el, clientX, clientY);
      const [x, y] = stageToContent(view, content.orientation, content.width, content.height, px, py);
      try {
        const rgba = sampler.current(x, y);
        return rgba && { clientX, clientY, hex: hex(rgba), rgba: [rgba[0], rgba[1], rgba[2], rgba[3]] };
      } catch {
        return null; // tainted or released canvas
      }
    },
    [enabled, stageRef, content, view],
  );

  const onPointerMove = (e: PointerEvent) => setProbe(sample(e.clientX, e.clientY));
  const onPointerLeave = () => setProbe(null);
  const pick = () => {
    if (!probe) return;
    void navigator.clipboard.writeText(probe.hex).then(() => toast(`已复制 ${probe.hex}`));
  };

  const registerSampler = useCallback((s: Sampler | null) => {
    sampler.current = s;
  }, []);

  return { probe: enabled ? probe : null, onPointerMove, onPointerLeave, pick, registerSampler };
}
