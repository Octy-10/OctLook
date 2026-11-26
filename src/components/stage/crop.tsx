import { useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { Check, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, X } from "lucide-react";

import { centreOffset, type StageContent } from "../../hooks/useViewport";
import { editActions, viewActions } from "../../lib/actions";
import { constrainCrop, moveCrop, resizeCrop, sizeCrop, type Crop } from "../../lib/crop";
import { keys } from "../../lib/platform";
import { stageToContent, type View } from "../../lib/viewport";
import { useEditState } from "../../store/edit";
import { useViewState } from "../../store/view";
import styles from "./crop.module.css";
import bar from "./toolbar.module.css";

/** (hx, hy): which edges a handle drags; (0, 0) is the box itself. */
const HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

/** True when the content's axes are swapped on screen. */
const isTurned = (view: View, content: StageContent) => (view.rotation + content.orientation.rotation) % 180 !== 0;

/** Resize cursor for a handle, as it appears after rotation and flips. */
function handleCursor(hx: number, hy: number, view: View, content: StageContent) {
  const turned = isTurned(view, content);
  if (!hx || !hy) return (hx !== 0) !== turned ? "ew-resize" : "ns-resize";
  const mirrored = [turned, view.flipX, view.flipY, content.orientation.mirror].filter(Boolean).length % 2 === 1;
  return (hx * hy > 0) !== mirrored ? "nwse-resize" : "nesw-resize";
}

interface OverlayProps {
  stageRef: RefObject<HTMLElement | null>;
  /** The uncropped content the rectangle is drawn on. */
  content: StageContent;
  draft: Crop;
}

/** Interactive crop rectangle, rendered in content space inside the stage box. */
export function CropOverlay({ stageRef, content, draft }: OverlayProps) {
  const view = useViewState((s) => s.view);
  const grip = useRef<{ hx: number; hy: number; from: [number, number]; origin: Crop } | null>(null);

  const toContent = (e: PointerEvent) =>
    stageToContent(view, content.orientation, content.width, content.height, ...centreOffset(stageRef.current!, e.clientX, e.clientY));

  const grab = (hx: number, hy: number) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    grip.current = { hx, hy, from: toContent(e), origin: draft };
  };
  const onPointerMove = (e: PointerEvent) => {
    const g = grip.current;
    if (!g) return;
    const [x, y] = toContent(e);
    const { aspect, set } = useEditState.getState();
    const ratio = aspect && (isTurned(view, content) ? 1 / aspect : aspect);
    const { width, height } = content;
    set({
      draft: g.hx || g.hy
        ? resizeCrop(g.origin, g.hx, g.hy, x, y, width, height, ratio)
        : moveCrop(g.origin, x - g.from[0], y - g.from[1], width, height),
    });
  };
  const release = () => {
    grip.current = null;
  };

  const rect: CSSProperties = { left: draft.x, top: draft.y, width: draft.width, height: draft.height };
  return (
    <div className={styles.overlay} style={{ "--px": `${1 / view.scale}px` } as CSSProperties}>
      <div className={styles.shade}>
        <div style={rect} />
      </div>
      <div
        className={styles.box}
        style={rect}
        onPointerDown={grab(0, 0)}
        onPointerMove={onPointerMove}
        onLostPointerCapture={release}
        onDoubleClick={(e) => {
          e.stopPropagation();
          editActions.applyCrop();
        }}
      >
        {HANDLES.map(([hx, hy]) => (
          <span
            key={`${hx},${hy}`}
            className={styles.handle}
            style={{ left: `${(hx + 1) * 50}%`, top: `${(hy + 1) * 50}%`, cursor: handleCursor(hx, hy, view, content) }}
            onPointerDown={grab(hx, hy)}
          />
        ))}
      </div>
    </div>
  );
}

/** A pixel dimension shown live and editable: Enter or leaving the field applies it, Escape reverts. */
function SizeField({ label, value, onCommit }: { label: string; value: number; onCommit(value: number): void }) {
  // Non-null while the user is typing; otherwise the field follows the crop.
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    const v = Number(typed);
    if (typed !== null && Number.isFinite(v) && v >= 1) onCommit(Math.round(v));
    setTyped(null);
  };
  return (
    <input
      className={bar.number}
      aria-label={label}
      inputMode="numeric"
      value={typed ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setTyped(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          e.stopPropagation(); // reverts the field; a second Escape cancels the crop
          setTyped(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const RATIOS: [label: string, ratio: number][] = [["1:1", 1], ["4:3", 4 / 3], ["3:2", 3 / 2], ["16:9", 16 / 9], ["3:4", 3 / 4], ["9:16", 9 / 16]];

/** Ratios survive rotation as reciprocals, so compare with a tolerance. */
const sameRatio = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9);

const TRANSFORMS = [
  ["向左旋转  Shift R", RotateCcw, () => viewActions.rotate(-1)],
  ["向右旋转  R", RotateCw, () => viewActions.rotate(1)],
  ["水平翻转  H", FlipHorizontal2, viewActions.flipX],
  ["垂直翻转  V", FlipVertical2, viewActions.flipY],
] as const;

/** Crop tool controls: rotate / flip, aspect presets, live size, cancel / apply. */
export function CropBar({ content, draft }: Omit<OverlayProps, "stageRef">) {
  const view = useViewState((s) => s.view);
  const aspect = useEditState((s) => s.aspect);
  const turned = isTurned(view, content);
  const [w, h] = turned ? [draft.height, draft.width] : [draft.width, draft.height];
  const original = turned ? content.height / content.width : content.width / content.height;

  /** Applies a typed on-screen size; with a locked ratio the other side follows. */
  const resize = (side: "width" | "height", value: number) => {
    let [sw, sh] = side === "width" ? [value, aspect ? value / aspect : h] : [aspect ? value * aspect : w, value];
    if (turned) [sw, sh] = [sh, sw];
    useEditState.getState().set({ draft: sizeCrop(draft, sw, sh, content.width, content.height) });
  };

  const lock = (ratio: number | null) => {
    const contentRatio = ratio && (turned ? 1 / ratio : ratio);
    useEditState.getState().set({
      aspect: ratio,
      draft: contentRatio ? constrainCrop(draft, content.width, content.height, contentRatio) : draft,
    });
  };

  return (
    <div className={bar.bar} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {TRANSFORMS.map(([tip, Icon, run]) => (
        <button key={tip} className={bar.action} aria-label={tip.split(" ")[0]} data-tip={keys(tip)} data-tip-side="bottom" onClick={run}>
          <Icon size={15} />
        </button>
      ))}
      <span className={bar.divider} />
      {([["自由", null], ["原始", original], ...RATIOS] as [string, number | null][]).map(([label, ratio]) => (
        <button key={label} className={bar.chip} data-active={sameRatio(aspect, ratio) || undefined} onClick={() => lock(ratio)}>
          {label}
        </button>
      ))}
      <span className={bar.divider} />
      <div className={bar.size}>
        <SizeField label="裁剪宽度" value={Math.round(w)} onCommit={(v) => resize("width", v)} />
        <span>×</span>
        <SizeField label="裁剪高度" value={Math.round(h)} onCommit={(v) => resize("height", v)} />
        <span>px</span>
      </div>
      <span className={bar.divider} />
      <button className={bar.action} data-tip="取消  Esc" data-tip-side="bottom" onClick={editActions.cancelCrop}>
        <X size={15} />
      </button>
      <button className={bar.action} data-primary data-tip="应用裁剪  Enter" data-tip-side="bottom" onClick={editActions.applyCrop}>
        <Check size={15} />
      </button>
    </div>
  );
}
