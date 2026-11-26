import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Film, Music, Play, Type, type LucideIcon } from "lucide-react";

import { useAsync } from "../../hooks/useAsync";
import { useElementSize } from "../../hooks/useElementSize";
import type { Category, FileEntry } from "../../lib/ipc";
import { getThumbnail } from "../../lib/thumbs";
import { useLibrary } from "../../store/library";
import { useViewState } from "../../store/view";
import styles from "./Filmstrip.module.css";

const ITEM = 64;
const GAP = 6;
const PAD = 12;
const STRIDE = ITEM + GAP;
const OVERSCAN = 6;
/** Requested thumbnail edge in device pixels (crisp up to 2.5× DPR). */
const THUMB_PX = 160;

const loadThumb = (path: string) => getThumbnail(path, THUMB_PX);
const extension = (name: string) => name.slice(name.lastIndexOf(".") + 1).toUpperCase();

/** Stand-ins for files nothing could be drawn for (audio without cover art, undecodable video…). */
const ICONS: Partial<Record<Category, LucideIcon>> = { video: Film, audio: Music, text: FileText, font: Type };

const Thumb = memo(function Thumb({ entry }: { entry: FileEntry }) {
  const thumb = useAsync(entry.path, loadThumb);
  const Icon = thumb && ICONS[thumb.category];
  if (thumb?.url) {
    return (
      <>
        <img src={thumb.url} alt="" draggable={false} decoding="async" />
        <span className={styles.badge}>{extension(entry.name)}</span>
        {thumb.category === "video" && (
          <span className={styles.play}>
            <Play size={8} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </>
    );
  }
  if (Icon) {
    return (
      <span className={styles.kind}>
        <Icon size={20} strokeWidth={1.5} />
        <span className={styles.ext}>{extension(entry.name)}</span>
      </span>
    );
  }
  return <span className={styles.ext} data-pending={thumb === undefined || undefined}>{extension(entry.name)}</span>;
});

/** Drawer tab on the strip's top-left edge; it stays at the window's bottom-left while the strip is hidden. */
export function FilmstripToggle() {
  const shown = useViewState((s) => s.filmstrip);
  const label = shown ? "收起缩略图栏" : "展开缩略图栏";
  return (
    <button
      className={styles.toggle}
      aria-label={label}
      aria-expanded={shown}
      data-tip={`${label}  T`}
      data-tip-align="start"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => useViewState.getState().toggle("filmstrip")}
    >
      {shown ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
    </button>
  );
}

/** Virtualised horizontal strip: only visible thumbnails are mounted. */
export function Filmstrip() {
  const entries = useLibrary((s) => s.entries);
  const index = useLibrary((s) => s.index);
  const go = useLibrary((s) => s.go);
  const ref = useRef<HTMLDivElement>(null);
  const [width] = useElementSize(ref);
  // Tracked per item, not per pixel: scrolling re-renders only when the window shifts.
  const [lead, setLead] = useState(0);

  // Keep the current item centred.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ left: PAD + index * STRIDE + ITEM / 2 - el.clientWidth / 2, behavior: "smooth" });
  }, [index, width]);

  // Vertical wheel scrolls the strip horizontally.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const first = Math.max(0, lead - OVERSCAN);
  const last = Math.min(entries.length, lead + Math.ceil(width / STRIDE) + 1 + OVERSCAN);
  const total = PAD * 2 + entries.length * STRIDE - GAP;

  return (
    <nav ref={ref} className={styles.strip} onScroll={(e) => setLead(Math.floor(Math.max(0, e.currentTarget.scrollLeft - PAD) / STRIDE))}>
      <div className={styles.track} style={{ width: total }}>
        {entries.slice(first, last).map((entry, i) => {
          const at = first + i;
          return (
            <button
              key={entry.path}
              className={styles.item}
              style={{ left: PAD + at * STRIDE }}
              data-current={at === index || undefined}
              title={entry.name}
              onClick={() => go(at)}
            >
              <Thumb entry={entry} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
