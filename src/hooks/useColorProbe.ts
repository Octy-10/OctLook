import { useCallback, useState, type PointerEvent, type RefObject } from "react";

import { toHex } from "../lib/format";
import { getSurface } from "../lib/surface";
import { stageToContent } from "../lib/viewport";
import { toast } from "../store/toast";
import { useViewState } from "../store/view";
import { centreOffset, type StageContent } from "./useViewport";

export interface Probe {
  clientX: number;
  clientY: number;
  hex: string;
  rgba: [number, number, number, number];
}

/** Eyedropper: live colour under the cursor, click copies its HEX. */
export function useColorProbe(enabled: boolean, stageRef: RefObject<HTMLElement | null>, content: StageContent | null) {
  const view = useViewState((s) => s.view);
  const [probe, setProbe] = useState<Probe | null>(null);

  const sample = useCallback(
    (clientX: number, clientY: number): Probe | null => {
      const el = stageRef.current;
      const surface = getSurface();
      if (!enabled || !el || !content || !surface) return null;
      const [px, py] = centreOffset(el, clientX, clientY);
      const [x, y] = stageToContent(view, content.orientation, content.width, content.height, px, py);
      try {
        const rgba = surface.sample(x + content.x, y + content.y);
        return rgba && { clientX, clientY, hex: toHex(rgba[0], rgba[1], rgba[2]), rgba: [rgba[0], rgba[1], rgba[2], rgba[3]] };
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

  return { probe: enabled ? probe : null, onPointerMove, onPointerLeave, pick };
}
