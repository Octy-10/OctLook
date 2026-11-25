import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { fileActions, viewActions, windowActions } from "../lib/actions";
import { api } from "../lib/ipc";
import { useLibrary } from "../store/library";
import { useViewState } from "../store/view";

type Binding = [match: (e: KeyboardEvent) => boolean, run: () => unknown];

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => (e: KeyboardEvent) =>
  e.key.toLowerCase() === k.toLowerCase() && e.ctrlKey === !!mods.ctrl && (mods.shift === undefined || e.shiftKey === mods.shift);
const any = (...ms: ((e: KeyboardEvent) => boolean)[]) => (e: KeyboardEvent) => ms.some((m) => m(e));

const library = () => useLibrary.getState();
const view = () => useViewState.getState();

const pageStep = (delta: number) => {
  const { page, setPage } = view();
  setPage(Math.max(1, page + delta)); // clamped to the page count by the PDF layer
};

/** Global keyboard map. Documented in the empty state and README. */
const BINDINGS: Binding[] = [
  [any(key("ArrowRight"), key("PageDown"), key(" ", { shift: false })), () => library().step(1)],
  [any(key("ArrowLeft"), key("PageUp"), key(" ", { shift: true })), () => library().step(-1)],
  [key("Home"), () => library().go(0)],
  [key("End"), () => library().go(Infinity)],
  [key("ArrowDown"), () => pageStep(1)],
  [key("ArrowUp"), () => pageStep(-1)],
  [any(key("=", { ctrl: true }), key("+"), key("=")), viewActions.zoomIn],
  [any(key("-", { ctrl: true }), key("-")), viewActions.zoomOut],
  [any(key("0", { ctrl: true }), key("0")), viewActions.fit],
  [any(key("1", { ctrl: true }), key("1")), viewActions.actualSize],
  [key("r", { shift: false }), () => viewActions.rotate(1)],
  [key("r", { shift: true }), () => viewActions.rotate(-1)],
  [key("h"), viewActions.flipX],
  [key("v"), viewActions.flipY],
  [key("o", { ctrl: true, shift: false }), () => fileActions.openDialog()],
  [key("o", { ctrl: true, shift: true }), () => fileActions.openDialog(true)],
  [key("c", { ctrl: true, shift: true }), fileActions.copyPath],
  [key("e", { ctrl: true }), fileActions.reveal],
  [key("Delete"), fileActions.trash],
  [any(key("f"), key("F11")), windowActions.toggleFullscreen],
  [key("i"), () => view().toggle("info")],
  [key("t"), () => view().toggle("filmstrip")],
  [key("b"), () => view().cycleBackdrop()],
  [key("c"), () => view().toggle("picker")],
  [
    key("Escape"),
    () => {
      if (view().picker) view().toggle("picker");
      else void windowActions.exitFullscreen();
    },
  ],
];

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey) return;
      const hit = BINDINGS.find(([match]) => match(e));
      if (!hit) return;
      e.preventDefault();
      void hit[1]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Opens the file passed on the command line, once. */
export function useLaunchPath() {
  useEffect(() => {
    void api.launchPath().then((path) => {
      if (path) void fileActions.openPath(path);
    });
  }, []);
}

/** Native file drops; returns true while a drag hovers the window. */
export function useFileDrop(): boolean {
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") setHovering(true);
      else if (payload.type === "leave") setHovering(false);
      else if (payload.type === "drop") {
        setHovering(false);
        if (payload.paths[0]) void fileActions.openPath(payload.paths[0]);
      }
    });
    return () => void unlisten.then((off) => off());
  }, []);
  return hovering;
}

export function useWindowFlags() {
  const [flags, setFlags] = useState({ maximized: false, fullscreen: false });
  useEffect(() => {
    const win = getCurrentWindow();
    const sync = async () => setFlags({ maximized: await win.isMaximized(), fullscreen: await win.isFullscreen() });
    void sync();
    const unlisten = win.onResized(sync);
    return () => void unlisten.then((off) => off());
  }, []);
  return flags;
}

/** Mirrors the current file name into the OS window title (taskbar). */
export function useWindowTitle() {
  const name = useLibrary((s) => s.entries[s.index]?.name);
  useEffect(() => {
    void getCurrentWindow().setTitle(name ? `${name} — OctLook` : "OctLook");
  }, [name]);
}
