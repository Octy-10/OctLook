import { useRef } from "react";
import { Pin } from "lucide-react";

import { PreviewContextMenu, useContextMenu } from "./components/chrome/ContextMenu";
import { OpenElsewhere } from "./components/chrome/OpenElsewhere";
import bar from "./components/chrome/TitleBar.module.css";
import { Logo } from "./components/Logo";
import { Toaster } from "./components/Overlays";
import { SourceStage } from "./components/viewers/SourceStage";
import { useTheme } from "./hooks/useAppBindings";
import { closePreview, usePinned, usePreviewWindow } from "./hooks/usePreviewWindow";
import { useSource } from "./hooks/useSource";
import { api } from "./lib/ipc";
import { useCurrentEntry } from "./store/library";
import styles from "./App.module.css";

/** Same scale and 1 px line as the drawn close glyph beside them. */
const CAPTION_ICON = { size: 12, strokeWidth: 1, absoluteStrokeWidth: true };

/** A preview window (Windows), the Space preview or a pinned one: a read-only viewer under a slim title bar. */
export function PreviewApp() {
  useTheme();
  const menu = useContextMenu();
  const state = useSource();
  const header = useRef<HTMLElement>(null);
  usePreviewWindow(state, header);
  const entry = useCurrentEntry();
  const pinned = usePinned((s) => s.pinned);
  if (!entry) return null;
  // The preview stays on top: once another app took the file, it steps aside (unless pinned).
  const leave = () => !pinned && closePreview();

  return (
    <div className={styles.app}>
      <header ref={header} className={bar.bar} data-tauri-drag-region>
        <div className={bar.brand} data-tauri-drag-region>
          <button
            className={bar.home}
            aria-label="在 OctLook 中打开"
            data-tip="在 OctLook 中打开"
            data-tip-side="bottom"
            data-tip-align="start"
            onClick={() => void api.openInMain(entry.path)}
          >
            <Logo size={16} />
          </button>
        </div>
        <div className={bar.title} data-tauri-drag-region>
          <span className={bar.name} data-tauri-drag-region>
            {entry.name}
          </span>
        </div>
        <div className={bar.caption}>
          <OpenElsewhere path={entry.path} icon={CAPTION_ICON} onOpened={leave} />
          {!pinned && (
            <button
              aria-label="钉住"
              data-tip="钉住：留在屏幕上，空格继续预览其他文件"
              data-tip-side="bottom"
              data-tip-align="end"
              onClick={() => void api.quicklookPin()}
            >
              <Pin {...CAPTION_ICON} />
            </button>
          )}
          <button aria-label="关闭" className={bar.close} onClick={closePreview}>
            <svg viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </button>
        </div>
      </header>
      {/* Any kind of file (video, text…) offers the menu here, not only images. */}
      <main className={styles.main} data-context-menu>
        <div className={styles.viewer}>
          <SourceStage {...state} />
        </div>
      </main>
      {menu.at && <PreviewContextMenu at={menu.at} path={entry.path} onClose={menu.close} onOpened={leave} />}
      <Toaster />
    </div>
  );
}
