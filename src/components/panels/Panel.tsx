import type { ReactNode } from "react";
import { X } from "lucide-react";

import { useViewState } from "../../store/view";
import styles from "./Panel.module.css";

/** Shell shared by the side panels: glass card, title, close button, action footer. */
export function Panel({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  const setPanel = useViewState((s) => s.setPanel);
  return (
    <aside className={styles.panel} onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <h3>{title}</h3>
        <button className={styles.icon} aria-label="关闭" onClick={() => setPanel(null)}>
          <X size={14} />
        </button>
      </header>
      {children}
      {footer && <footer>{footer}</footer>}
    </aside>
  );
}
