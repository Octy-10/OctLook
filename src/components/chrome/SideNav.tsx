import { ChevronLeft, ChevronRight } from "lucide-react";

import { keys } from "../../lib/platform";
import { useLibrary } from "../../store/library";
import { useViewState } from "../../store/view";
import styles from "./SideNav.module.css";

/** Previous / next file at the viewer's edges, fading out with the HUD when the pointer rests. */
export function SideNav({ hidden }: { hidden: boolean }) {
  const step = useLibrary((s) => s.step);
  const single = useLibrary((s) => s.entries.length < 2);
  // The right arrow steps aside for an open side panel.
  const panel = useViewState((s) => s.panel !== null);
  if (single) return null;

  return (
    <>
      <button
        className={styles.nav}
        data-side="left"
        data-hidden={hidden || undefined}
        aria-label="上一张"
        data-tip={keys("上一张  ←")}
        data-tip-align="start"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => step(-1)}
      >
        <ChevronLeft size={22} strokeWidth={1.75} />
      </button>
      <button
        className={styles.nav}
        data-side="right"
        data-panel={panel || undefined}
        data-hidden={hidden || undefined}
        aria-label="下一张"
        data-tip={keys("下一张  →")}
        data-tip-align="end"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => step(1)}
      >
        <ChevronRight size={22} strokeWidth={1.75} />
      </button>
    </>
  );
}
