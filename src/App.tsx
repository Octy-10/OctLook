import { ContextMenu, useContextMenu } from "./components/chrome/ContextMenu";
import { Hud } from "./components/chrome/Hud";
import { TitleBar } from "./components/chrome/TitleBar";
import { EmptyState } from "./components/EmptyState";
import { DropOverlay, Toaster } from "./components/Overlays";
import { Filmstrip, FilmstripToggle } from "./components/panels/Filmstrip";
import { EditPanel } from "./components/panels/EditPanel";
import { InfoPanel } from "./components/panels/InfoPanel";
import { TextPanel } from "./components/panels/TextPanel";
import { Stage } from "./components/stage/Stage";
import { UpdateNotice } from "./components/UpdateNotice";
import { useFileDrop, useKeyboard, useLaunchPath, useTheme, useWindowFlags, useWindowTitle } from "./hooks/useAppBindings";
import { useIdle } from "./hooks/useIdle";
import { useLaunchUpdateCheck } from "./hooks/useUpdater";
import { useSource } from "./hooks/useSource";
import { useLibrary } from "./store/library";
import { useViewState } from "./store/view";
import styles from "./App.module.css";

const HUD_IDLE_MS = 1400;

export function App() {
  useKeyboard();
  useTheme();
  useLaunchPath();
  useLaunchUpdateCheck();
  useWindowTitle();
  const dropping = useFileDrop();
  const { maximized, fullscreen } = useWindowFlags();
  const idle = useIdle(HUD_IDLE_MS);
  const hasFiles = useLibrary((s) => s.entries.length > 0);
  const filmstrip = useViewState((s) => s.filmstrip);
  const panel = useViewState((s) => s.panel);
  const state = useSource();
  const menu = useContextMenu();

  return (
    <div className={styles.app}>
      {!fullscreen && <TitleBar maximized={maximized} />}
      {hasFiles ? (
        <main className={styles.main}>
          <div className={styles.viewer}>
            <Stage {...state} />
            <Hud source={state.source} hidden={idle} />
            {panel === "info" && <InfoPanel source={state.source} />}
            {panel === "edit" && <EditPanel />}
            {panel === "text" && <TextPanel />}
            {!fullscreen && <FilmstripToggle />}
          </div>
          {filmstrip && !fullscreen && <Filmstrip />}
        </main>
      ) : (
        <EmptyState />
      )}
      {hasFiles && menu.at && <ContextMenu at={menu.at} onClose={menu.close} />}
      {dropping && <DropOverlay />}
      <Toaster />
      <UpdateNotice />
    </div>
  );
}
