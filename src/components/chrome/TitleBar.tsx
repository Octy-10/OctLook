import { useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppWindow, Settings } from "lucide-react";

import { useDefaultApp } from "../../hooks/useDefaultApp";
import { fileActions, viewActions } from "../../lib/actions";
import { isMac } from "../../lib/platform";
import { useCurrentEntry, useLibrary } from "../../store/library";
import { useViewState } from "../../store/view";
import { Logo } from "../Logo";
import { SettingsMenu } from "./SettingsMenu";
import styles from "./TitleBar.module.css";

const win = getCurrentWindow();

/**
 * Window chrome: drag region, file context, settings and caption buttons.
 * macOS keeps its own traffic lights (overlay title bar), so it gets no caption buttons.
 */
export function TitleBar({ maximized }: { maximized: boolean }) {
  const name = useLibrary((s) => s.entries[s.index]?.name);
  const index = useLibrary((s) => s.index);
  const total = useLibrary((s) => s.entries.length);
  const zoom = useViewState((s) => Math.round(s.view.scale * 100));
  const fit = useViewState((s) => s.view.fit);
  const app = useDefaultApp(useCurrentEntry()?.path ?? null);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);

  return (
    <header className={styles.bar} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>
        {name ? (
          <button className={styles.home} data-tip="返回主页" data-tip-side="bottom" data-tip-align="start" onClick={useLibrary.getState().close}>
            <Logo size={16} />
            <span>OctLook</span>
          </button>
        ) : (
          <>
            <Logo size={16} />
            <span data-tauri-drag-region>OctLook</span>
          </>
        )}
        {name && (
          <button className={styles.zoom} data-tip={fit ? "实际大小  1" : "适应窗口  0"} data-tip-side="bottom" onClick={viewActions.toggleFit}>
            {zoom}%
          </button>
        )}
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
        {app && (
          <button aria-label={`用 ${app.name} 打开`} data-tip={`用 ${app.name} 打开`} data-tip-side="bottom" onClick={fileActions.openWithDefault}>
            {app.icon ? <img className={styles.appIcon} src={app.icon} alt="" draggable={false} /> : <AppWindow size={15} strokeWidth={1.75} />}
          </button>
        )}
        <div className={styles.anchor}>
          <button aria-label="设置" data-tip={menu ? undefined : "设置"} data-tip-side="bottom" data-active={menu || undefined} onClick={() => setMenu((open) => !open)}>
            <Settings size={15} strokeWidth={1.75} />
          </button>
          {menu && <SettingsMenu onClose={closeMenu} />}
        </div>
        {!isMac && <WindowButtons maximized={maximized} />}
      </div>
    </header>
  );
}

function WindowButtons({ maximized }: { maximized: boolean }) {
  return (
    <>
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
    </>
  );
}
