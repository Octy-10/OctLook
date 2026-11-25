import { memo, useEffect, useRef, useState } from "react";

import { useAsync } from "../../hooks/useAsync";
import { useElementSize } from "../../hooks/useElementSize";
import type { FileEntry } from "../../lib/ipc";
import { getThumbnail } from "../../lib/thumbs";
import { useLibrary } from "../../store/library";
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

const Thumb = memo(function Thumb({ entry }: { entry: FileEntry }) {
  const url = useAsync(entry.path, loadThumb);
  if (url) return <img src={url} alt="" draggable={false} decoding="async" />;
  return <span className={styles.ext} data-pending={url === undefined || undefined}>{extension(entry.name)}</span>;
});

/** Virtualised horizontal strip: only visible thumbnails are mounted. */
export function Filmstrip() {
  const entries = useLibrary((s) => s.entries);
  const index = useLibrary((s) => s.index);
  const go = useLibrary((s) => s.go);
  const ref = useRef<HTMLDivElement>(null);
  const [width] = useElementSize(ref);
  const [scroll, setScroll] = useState(0);

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

  const first = Math.max(0, Math.floor((scroll - PAD) / STRIDE) - OVERSCAN);
  const last = Math.min(entries.length, Math.ceil((scroll + width) / STRIDE) + OVERSCAN);
  const total = PAD * 2 + entries.length * STRIDE - GAP;

  return (
    <nav ref={ref} className={styles.strip} onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}>
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
