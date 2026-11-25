import type { PointerEvent } from "react";
import { FileWarning, FolderSearch } from "lucide-react";

import type { Probe } from "../../hooks/useColorProbe";
import { fileActions } from "../../lib/actions";
import { REVEAL_LABEL } from "../../lib/platform";
import { useEditState } from "../../store/edit";
import styles from "./Stage.module.css";

export function Loupe({ probe }: { probe: Probe }) {
  const [r, g, b, a] = probe.rgba;
  return (
    <div className={styles.loupe} style={{ left: probe.clientX + 18, top: probe.clientY + 18 }}>
      <span className={styles.swatch} style={{ background: `rgba(${r},${g},${b},${a / 255})` }} />
      <span className={styles.hex}>{probe.hex}</span>
      <span className={styles.rgb}>
        {r} {g} {b}
        {a < 255 && ` · ${Math.round((a / 255) * 100)}%`}
      </span>
    </div>
  );
}

/** Draggable divider of the before / after split, positioned at `at` (0 … 1). */
export function SplitDivider({ at }: { at: number }) {
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const stage = e.currentTarget.parentElement!.getBoundingClientRect();
    useEditState.getState().set({ split: Math.min(1, Math.max(0, (e.clientX - stage.left) / stage.width)) });
  };
  return (
    <div
      className={styles.split}
      style={{ left: `${at * 100}%` }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span>原图</span>
      <span>调整后</span>
    </div>
  );
}

export function StageError({ message }: { message: string }) {
  return (
    <div className={styles.error} onPointerDown={(e) => e.stopPropagation()}>
      <FileWarning size={28} strokeWidth={1.5} />
      <h2>无法预览此文件</h2>
      <p>{message}</p>
      <button onClick={fileActions.reveal}>
        <FolderSearch size={14} /> {REVEAL_LABEL}
      </button>
    </div>
  );
}
