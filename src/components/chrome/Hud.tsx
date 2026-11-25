import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crop,
  PenLine,
  Pipette,
  RotateCw,
  Save,
  ScanText,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";

import { editActions, viewActions } from "../../lib/actions";
import { isNeutral } from "../../lib/edits";
import type { ImageSource } from "../../lib/source";
import { useEditState } from "../../store/edit";
import { useLibrary } from "../../store/library";
import { useViewState } from "../../store/view";
import styles from "./Hud.module.css";

const ICON = { size: 16, strokeWidth: 1.75 };

function Tool(props: { label: string; tip?: string; onClick(): void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      className={styles.tool}
      data-tip={props.tip}
      aria-label={props.label}
      data-active={props.active || undefined}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

const Divider = () => <span className={styles.divider} />;

/**
 * Floating, auto-hiding control capsule. It carries only the primary tools;
 * the settings menu and the zoom level live in the title bar.
 */
export function Hud({ source, hidden }: { source: ImageSource | null; hidden: boolean }) {
  // Narrow selectors: the capsule must not re-render on every pan frame.
  const turned = useViewState((s) => s.view.rotation !== 0 || s.view.flipX || s.view.flipY);
  const page = useViewState((s) => s.page);
  const picker = useViewState((s) => s.picker);
  const panel = useViewState((s) => s.panel);
  const { toggle, togglePanel, setPage } = useViewState.getState();
  const cropping = useEditState((s) => s.draft !== null);
  const annotating = useEditState((s) => s.tool !== null);
  const edited = useEditState((s) => s.crop !== null || s.annotations.length > 0 || !isNeutral(s.adjust)) || turned;
  const step = useLibrary((s) => s.step);
  const single = useLibrary((s) => s.entries.length < 2);
  const pages = source?.kind === "pdf" ? source.pages : 1;
  // Never fades out from under a pointer resting on it.
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={styles.hud}
      data-hidden={(hidden && !hovered) || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Tool label="上一张" tip="上一张  ←" onClick={() => step(-1)} disabled={single}>
        <ChevronLeft {...ICON} />
      </Tool>
      <Divider />
      <Tool label="旋转" tip="旋转  R" onClick={() => viewActions.rotate(1)}>
        <RotateCw {...ICON} />
      </Tool>
      <Tool label="裁剪" tip="裁剪  X" onClick={editActions.toggleCrop} active={cropping}>
        <Crop {...ICON} />
      </Tool>
      <Tool label="标注" tip="标注  A" onClick={editActions.toggleAnnotate} active={annotating}>
        <PenLine {...ICON} />
      </Tool>
      <Tool label="调色" tip="调色  E" onClick={() => togglePanel("edit")} active={panel === "edit"}>
        <SlidersHorizontal {...ICON} />
      </Tool>
      <Tool label="取色器" tip="取色器  C" onClick={() => toggle("picker")} active={picker}>
        <Pipette {...ICON} />
      </Tool>
      <Tool label="提取文字" tip="提取文字  O" onClick={editActions.extractText} active={panel === "text"}>
        <ScanText {...ICON} />
      </Tool>
      {edited && (
        <Tool label="重置全部编辑" tip="重置全部编辑  Ctrl R" onClick={editActions.reset}>
          <Undo2 {...ICON} />
        </Tool>
      )}
      {pages > 1 && (
        <>
          <Divider />
          <Tool label="上一页" tip="上一页  ↑" onClick={() => setPage(page - 1)} disabled={page <= 1}>
            <ChevronUp {...ICON} />
          </Tool>
          <span className={styles.pages}>
            {Math.min(page, pages)} / {pages}
          </span>
          <Tool label="下一页" tip="下一页  ↓" onClick={() => setPage(page + 1)} disabled={page >= pages}>
            <ChevronDown {...ICON} />
          </Tool>
        </>
      )}
      <Divider />
      <Tool label="导出" tip="导出  Ctrl S" onClick={editActions.export}>
        <Save {...ICON} />
      </Tool>
      <Divider />
      <Tool label="下一张" tip="下一张  →" onClick={() => step(1)} disabled={single}>
        <ChevronRight {...ICON} />
      </Tool>
    </div>
  );
}
