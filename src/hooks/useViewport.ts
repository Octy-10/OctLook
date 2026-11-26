import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";

import { fitScale, zoomAt, type Orientation, type Rect, type View } from "../lib/viewport";
import { useViewState } from "../store/view";

/** The box on stage: a `width × height` window at (x, y) into the source content. */
export interface StageContent extends Rect {
  orientation: Orientation;
}

/** Click vs. drag threshold in CSS px. */
const DRAG_SLOP = 3;

/** Client point → offset from the element centre. */
export function centreOffset(el: HTMLElement, clientX: number, clientY: number): [number, number] {
  const r = el.getBoundingClientRect();
  return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2];
}

type ViewUpdate = (v: View) => View;

/**
 * Coalesces gesture updates into one store write per frame: high-rate mice
 * and trackpads emit several events between two paints.
 */
function useFrameBatched(apply: (update: ViewUpdate) => void) {
  const queue = useRef<ViewUpdate[]>([]);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return useCallback(
    (update: ViewUpdate) => {
      if (queue.current.push(update) > 1) return; // a flush is already scheduled
      frame.current = requestAnimationFrame(() => {
        const updates = queue.current;
        queue.current = [];
        apply((v) => updates.reduce((acc, u) => u(acc), v));
      });
    },
    [apply],
  );
}

/**
 * Pan / zoom interaction for the stage: wheel & pinch zoom around the
 * cursor, drag to pan, double-click to toggle fit ↔ 100 %, and keeps the
 * fit scale in sync with stage size and rotation.
 */
export function useViewport(
  stageRef: RefObject<HTMLElement | null>,
  [stageW, stageH]: [number, number],
  content: StageContent | null,
  onClick?: (px: number, py: number) => void,
) {
  const view = useViewState((s) => s.view);
  const setView = useViewState((s) => s.setView);
  const setFitScale = useViewState((s) => s.setFitScale);
  const queueView = useFrameBatched(setView);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const fit = content && stageW > 0 ? fitScale(content.width, content.height, view, content.orientation, stageW, stageH) : 1;
  useEffect(() => {
    setFitScale(fit);
    if (view.fit && (view.scale !== fit || view.x !== 0 || view.y !== 0)) setView({ scale: fit, x: 0, y: 0 });
  }, [fit, view.fit, view.scale, view.x, view.y, setView, setFitScale]);

  // Wheel must be non-passive so the WebView never page-zooms.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dx = e.deltaX * unit;
        queueView((v) => ({ ...v, x: v.x - dx, fit: false })); // horizontal trackpad swipe
        return;
      }
      // Pinch gestures arrive as ctrl+wheel with small deltas: amplify them.
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018));
      const [px, py] = centreOffset(el, e.clientX, e.clientY);
      queueView((v) => zoomAt(v, v.scale * factor, px, py));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef, queueView]);

  const handlers = {
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0 && e.button !== 1) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove(e: PointerEvent) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!d.moved) setDragging(true);
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      queueView((v) => ({ ...v, x: v.x + dx, y: v.y + dy, fit: false }));
    },
    onPointerUp(e: PointerEvent) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      setDragging(false);
      if (!d.moved && e.button === 0) onClick?.(...centreOffset(e.currentTarget as HTMLElement, e.clientX, e.clientY));
    },
    onDoubleClick(e: MouseEvent) {
      const [px, py] = centreOffset(e.currentTarget as HTMLElement, e.clientX, e.clientY);
      setView((v) => (v.fit ? zoomAt(v, fit >= 1 ? 2 : 1, px, py) : { ...v, fit: true }));
    },
  };

  return { view, dragging, handlers };
}
