import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FlipHorizontal2,
  GalleryHorizontalEnd,
  Grid2x2,
  Info,
  Minus,
  Moon,
  Pipette,
  Plus,
  RotateCcw,
  RotateCw,
  Scan,
  Sun,
  Trash2,
} from "lucide-react";

import { fileActions, viewActions } from "../../lib/actions";
import type { ImageSource } from "../../lib/source";
import { useLibrary } from "../../store/library";
import { useViewState, type Backdrop } from "../../store/view";
import styles from "./Hud.module.css";

const ICON = { size: 16, strokeWidth: 1.75 };
const BACKDROP_ICON: Record<Backdrop, ReactNode> = {
  dark: <Moon {...ICON} />,
  light: <Sun {...ICON} />,
  checker: <Grid2x2 {...ICON} />,
};
const BACKDROP_LABEL: Record<Backdrop, string> = { dark: "深色", light: "浅色", checker: "透明网格" };

function Tool(props: { tip: string; onClick(): void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      className={styles.tool}
      data-tip={props.tip}
      data-active={props.active || undefined}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

const Divider = () => <span className={styles.divider} />;

/** Floating, auto-hiding control capsule. */
export function Hud({ source, hidden }: { source: ImageSource | null; hidden: boolean }) {
  const { view, page, backdrop, picker, info, filmstrip, toggle, cycleBackdrop, setPage } = useViewState();
  const step = useLibrary((s) => s.step);
  const single = useLibrary((s) => s.entries.length < 2);
  const pages = source?.kind === "pdf" ? source.pages : 1;

  return (
    <div className={styles.hud} data-hidden={hidden || undefined} onPointerDown={(e) => e.stopPropagation()}>
      <Tool tip="上一张  ←" onClick={() => step(-1)} disabled={single}>
        <ChevronLeft {...ICON} />
      </Tool>
      <Divider />
      <Tool tip="缩小  −" onClick={viewActions.zoomOut}>
        <Minus {...ICON} />
      </Tool>
      <button className={styles.zoom} data-tip={view.fit ? "实际大小  1" : "适应窗口  0"} onClick={viewActions.toggleFit}>
        {Math.round(view.scale * 100)}%
      </button>
      <Tool tip="放大  +" onClick={viewActions.zoomIn}>
        <Plus {...ICON} />
      </Tool>
      <Tool tip="适应窗口  0" onClick={viewActions.fit} active={view.fit}>
        <Scan {...ICON} />
      </Tool>
      <Divider />
      <Tool tip="向左旋转  Shift R" onClick={() => viewActions.rotate(-1)}>
        <RotateCcw {...ICON} />
      </Tool>
      <Tool tip="向右旋转  R" onClick={() => viewActions.rotate(1)}>
        <RotateCw {...ICON} />
      </Tool>
      <Tool tip="水平翻转  H" onClick={viewActions.flipX} active={view.flipX}>
        <FlipHorizontal2 {...ICON} />
      </Tool>
      {pages > 1 && (
        <>
          <Divider />
          <Tool tip="上一页  ↑" onClick={() => setPage(page - 1)} disabled={page <= 1}>
            <ChevronUp {...ICON} />
          </Tool>
          <span className={styles.pages}>
            {Math.min(page, pages)} / {pages}
          </span>
          <Tool tip="下一页  ↓" onClick={() => setPage(page + 1)} disabled={page >= pages}>
            <ChevronDown {...ICON} />
          </Tool>
        </>
      )}
      <Divider />
      <Tool tip="取色器  C" onClick={() => toggle("picker")} active={picker}>
        <Pipette {...ICON} />
      </Tool>
      <Tool tip={`背景：${BACKDROP_LABEL[backdrop]}  B`} onClick={cycleBackdrop}>
        {BACKDROP_ICON[backdrop]}
      </Tool>
      <Tool tip="文件信息  I" onClick={() => toggle("info")} active={info}>
        <Info {...ICON} />
      </Tool>
      <Tool tip="缩略图栏  T" onClick={() => toggle("filmstrip")} active={filmstrip}>
        <GalleryHorizontalEnd {...ICON} />
      </Tool>
      <Tool tip="移至回收站  Del" onClick={fileActions.trash}>
        <Trash2 {...ICON} />
      </Tool>
      <Divider />
      <Tool tip="下一张  →" onClick={() => step(1)} disabled={single}>
        <ChevronRight {...ICON} />
      </Tool>
    </div>
  );
}
