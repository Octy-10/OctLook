import { getCurrentWindow } from "@tauri-apps/api/window";

import { useLibrary } from "../../store/library";
import { Logo } from "../Logo";
import styles from "./TitleBar.module.css";

const win = getCurrentWindow();

/** Frameless window chrome: drag region, file context and caption buttons. */
export function TitleBar({ maximized }: { maximized: boolean }) {
  const name = useLibrary((s) => s.entries[s.index]?.name);
  const index = useLibrary((s) => s.index);
  const total = useLibrary((s) => s.entries.length);

  return (
    <header className={styles.bar} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>
        <Logo size={16} />
        <span data-tauri-drag-region>OctLook</span>
      </div>

      <div className={styles.title} data-tauri-drag-region>
        {name && (
          <>
            <span className={styles.name} data-tauri-drag-region>
              {name}
            </span>
            <span className={styles.count} data-tauri-drag-region>
              {index + 1} / {total}
            </span>
          </>
        )}
      </div>

      <div className={styles.caption}>
        <button aria-label="最小化" onClick={() => win.minimize()}>
          <svg viewBox="0 0 10 10">
            <path d="M1 5h8" />
          </svg>
        </button>
        <button aria-label={maximized ? "还原" : "最大化"} onClick={() => win.toggleMaximize()}>
          <svg viewBox="0 0 10 10">
            {maximized ? <path d="M3 1h6v6M1 3h6v6H1z" /> : <rect x="1" y="1" width="8" height="8" />}
          </svg>
        </button>
        <button aria-label="关闭" className={styles.close} onClick={() => win.close()}>
          <svg viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1L1 9" />
          </svg>
        </button>
      </div>
    </header>
  );
}
