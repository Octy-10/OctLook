import { Hud } from "./components/chrome/Hud";
import { TitleBar } from "./components/chrome/TitleBar";
import { EmptyState } from "./components/EmptyState";
import { DropOverlay, Toaster } from "./components/Overlays";
import { Filmstrip } from "./components/panels/Filmstrip";
import { InfoPanel } from "./components/panels/InfoPanel";
import { Stage } from "./components/stage/Stage";
import { UpdateNotice } from "./components/UpdateNotice";
import { useFileDrop, useKeyboard, useLaunchPath, useWindowFlags, useWindowTitle } from "./hooks/useAppBindings";
import { useIdle } from "./hooks/useIdle";
import { useSource } from "./hooks/useSource";
import { useLibrary } from "./store/library";
import { useViewState } from "./store/view";
import styles from "./App.module.css";

const HUD_IDLE_MS = 2600;

export function App() {
  useKeyboard();
  useLaunchPath();
  useWindowTitle();
  const dropping = useFileDrop();
  const { maximized, fullscreen } = useWindowFlags();
  const idle = useIdle(HUD_IDLE_MS);
  const hasFiles = useLibrary((s) => s.entries.length > 0);
  const filmstrip = useViewState((s) => s.filmstrip);
  const info = useViewState((s) => s.info);
  const state = useSource();

  return (
    <div className={styles.app}>
      {!fullscreen && <TitleBar maximized={maximized} />}
      {hasFiles ? (
        <main className={styles.main}>
          <div className={styles.viewer}>
            <Stage {...state} />
            <Hud source={state.source} hidden={idle} />
            {info && <InfoPanel source={state.source} />}
          </div>
          {filmstrip && !fullscreen && <Filmstrip />}
        </main>
      ) : (
        <EmptyState />
      )}
      {dropping && <DropOverlay />}
      <Toaster />
      <UpdateNotice />
    </div>
  );
}
