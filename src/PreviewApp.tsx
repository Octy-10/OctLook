import { useRef } from "react";
import { AppWindow, Pin, SquareArrowOutUpRight } from "lucide-react";

import bar from "./components/chrome/TitleBar.module.css";
import { Logo } from "./components/Logo";
import { SourceStage } from "./components/viewers/SourceStage";
import { useTheme } from "./hooks/useAppBindings";
import { useDefaultApp } from "./hooks/useDefaultApp";
import { closePreview, pinnedPath, usePreviewWindow } from "./hooks/usePreviewWindow";
import { useSource } from "./hooks/useSource";
import { api } from "./lib/ipc";
import { useCurrentEntry } from "./store/library";
import styles from "./App.module.css";

/** A preview window (Windows), the Space preview or a pinned one: a read-only viewer under a slim title bar. */
export function PreviewApp() {
  useTheme();
  const state = useSource();
  const header = useRef<HTMLElement>(null);
  usePreviewWindow(state, header);
  const entry = useCurrentEntry();
  const app = useDefaultApp(entry?.path ?? null);
  if (!entry) return null;

  return (
    <div className={styles.app}>
      <header ref={header} className={bar.bar} data-tauri-drag-region>
        <div className={bar.brand} data-tauri-drag-region>
          <Logo size={16} />
        </div>
        <div className={bar.title} data-tauri-drag-region>
          <span className={bar.name} data-tauri-drag-region>
            {entry.name}
          </span>
        </div>
        <div className={bar.caption}>
          {app && (
            <button
              aria-label={`用 ${app.name} 打开`}
              data-tip={`用 ${app.name} 打开`}
              data-tip-side="bottom"
              onClick={() => void api.openWithDefault(entry.path).then(() => !pinnedPath && closePreview())}
            >
              {app.icon ? (
                <img className={bar.appIcon} src={app.icon} alt="" draggable={false} />
              ) : (
                <AppWindow size={15} strokeWidth={1.75} />
              )}
            </button>
          )}
          {!pinnedPath && (
            <button
              aria-label="钉住"
              data-tip="钉住：留在屏幕上，空格继续预览其他文件"
              data-tip-side="bottom"
              data-tip-align="end"
              onClick={() => void api.quicklookPin(entry.path)}
            >
              <Pin size={15} strokeWidth={1.75} />
            </button>
          )}
          <button
            aria-label="在 OctLook 中打开"
            data-tip="在 OctLook 中打开"
            data-tip-side="bottom"
            onClick={() => void api.openInMain(entry.path)}
          >
            <SquareArrowOutUpRight size={15} strokeWidth={1.75} />
          </button>
          <button aria-label="关闭" className={bar.close} onClick={closePreview}>
            <svg viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </button>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.viewer}>
          <SourceStage {...state} />
        </div>
      </main>
    </div>
  );
}
