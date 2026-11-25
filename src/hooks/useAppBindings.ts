import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { editActions, fileActions, viewActions, windowActions } from "../lib/actions";
import { api } from "../lib/ipc";
import { isMac, primaryKey } from "../lib/platform";
import { useEditState } from "../store/edit";
import { useLibrary } from "../store/library";
import { useViewState } from "../store/view";

type Binding = [match: (e: KeyboardEvent) => boolean, run: () => unknown];

/** `ctrl` means the platform's primary modifier: ⌘ on macOS. */
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => (e: KeyboardEvent) =>
  e.key.toLowerCase() === k.toLowerCase() && primaryKey(e) === !!mods.ctrl && (mods.shift === undefined || e.shiftKey === mods.shift);
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
  [key("r", { ctrl: true }), editActions.reset],
  [key("z", { ctrl: true, shift: false }), () => useEditState.getState().undo()],
  [any(key("z", { ctrl: true, shift: true }), key("y", { ctrl: true })), () => useEditState.getState().redo()],
  [key("r", { shift: false }), () => viewActions.rotate(1)],
  [key("r", { shift: true }), () => viewActions.rotate(-1)],
  [key("h"), viewActions.flipX],
  [key("v"), viewActions.flipY],
  [key("o", { ctrl: true, shift: false }), () => fileActions.openDialog()],
  [key("o", { ctrl: true, shift: true }), () => fileActions.openDialog(true)],
  [key("c", { ctrl: true, shift: true }), fileActions.copyPath],
  [key("c", { ctrl: true, shift: false }), editActions.copyImage],
  [key("s", { ctrl: true }), editActions.export],
  [key("x"), editActions.toggleCrop],
  [key("a"), editActions.toggleAnnotate],
  [key("Enter"), editActions.applyCrop],
  [key("e"), () => view().togglePanel("edit")],
  [key("o"), editActions.extractText],
  [key("e", { ctrl: true }), fileActions.reveal],
  // While annotating, Delete only ever removes annotations, never the file.
  // Mac keyboards label Backspace "delete"; elsewhere Backspace stays harmless.
  [isMac ? any(key("Delete"), key("Backspace")) : key("Delete"), () => (useEditState.getState().tool ? editActions.removeSelected() : fileActions.trash())],
  [any(key("f"), key("F11")), windowActions.toggleFullscreen],
  [key("i"), () => view().togglePanel("info")],
  [key("t"), () => view().toggle("filmstrip")],
  [key("b"), () => view().cycleBackdrop()],
  [key("c"), () => view().toggle("picker")],
  [
    key("Escape"),
    () => {
      if (useEditState.getState().draft) editActions.cancelCrop();
      else if (useEditState.getState().tool) editActions.toggleAnnotate();
      else if (view().picker) view().toggle("picker");
      else void windowActions.exitFullscreen();
    },
  ],
];

/** True while the keystroke belongs to a text field or an annotation being typed. */
const isTyping = ({ target }: KeyboardEvent) =>
  (target instanceof HTMLInputElement && target.type !== "range") || (target instanceof HTMLElement && target.isContentEditable);

/** Held, not toggled: shows the unadjusted image for as long as it is down. */
const COMPARE_KEY = "\\";

export function useKeyboard() {
  useEffect(() => {
    const compare = (comparing: boolean) => (e: KeyboardEvent) => {
      if (e.key === COMPARE_KEY && !isTyping(e)) useEditState.getState().set({ comparing });
    };
    const onKey = (e: KeyboardEvent) => {
      // The secondary modifier (Ctrl on macOS, Win elsewhere) belongs to the system.
      if (e.altKey || (isMac ? e.ctrlKey : e.metaKey) || isTyping(e)) return;
      const hit = BINDINGS.find(([match]) => match(e));
      if (!hit) return;
      e.preventDefault();
      void hit[1]();
    };
    const listeners = [["keydown", onKey], ["keydown", compare(true)], ["keyup", compare(false)]] as const;
    listeners.forEach(([type, fn]) => window.addEventListener(type, fn));
    return () => listeners.forEach(([type, fn]) => window.removeEventListener(type, fn));
  }, []);
}

/**
 * Opens the file the app was launched with (command line, or Finder before
 * the page loaded), then every file Finder hands the running app (macOS).
 */
export function useLaunchPath() {
  useEffect(() => {
    const unlisten = listen<string>("open-path", ({ payload }) => void fileActions.openPath(payload));
    void api.launchPath().then((path) => {
      if (path) void fileActions.openPath(path);
    });
    return () => void unlisten.then((off) => off());
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

/** Resolves the theme preference into `data-theme` on the root element. */
export function useTheme() {
  const theme = useViewState((s) => s.theme);
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (system.matches ? "light" : "dark") : theme;
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [theme]);
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
