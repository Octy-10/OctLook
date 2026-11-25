/**
 * Imperative app commands shared by the keyboard map, the HUD and menus.
 * They read/write the stores directly so callers stay declarative.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { useLibrary } from "../store/library";
import { toast } from "../store/toast";
import { useViewState } from "../store/view";
import { api, errorMessage } from "./ipc";
import { forgetThumbnail } from "./thumbs";
import { stepScale, zoomAt, type View } from "./viewport";

const setView = (update: (v: View) => View) => useViewState.getState().setView(update);
const currentPath = () => {
  const { entries, index } = useLibrary.getState();
  return entries[index]?.path ?? null;
};

export const viewActions = {
  zoomIn: () => setView((v) => zoomAt(v, stepScale(v.scale, 1), 0, 0)),
  zoomOut: () => setView((v) => zoomAt(v, stepScale(v.scale, -1), 0, 0)),
  fit: () => setView((v) => ({ ...v, fit: true })),
  actualSize: () => setView((v) => ({ ...v, scale: 1, x: 0, y: 0, fit: false })),
  toggleFit: () => (useViewState.getState().view.fit ? viewActions.actualSize() : viewActions.fit()),
  rotate: (direction: 1 | -1) => setView((v) => ({ ...v, rotation: (v.rotation + direction * 90 + 360) % 360, x: 0, y: 0 })),
  flipX: () => setView((v) => ({ ...v, flipX: !v.flipX })),
  flipY: () => setView((v) => ({ ...v, flipY: !v.flipY })),
};

let extensions: Promise<string[]> | null = null;

export const fileActions = {
  async openPath(path: string) {
    try {
      await useLibrary.getState().open(path);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },

  async openDialog(directory = false) {
    extensions ??= api.supportedExtensions();
    const picked = await openDialog({
      directory,
      multiple: false,
      filters: directory ? undefined : [{ name: "所有支持的格式", extensions: await extensions }],
    });
    if (typeof picked === "string") await fileActions.openPath(picked);
  },

  async trash() {
    const path = currentPath();
    if (!path) return;
    try {
      await api.moveToTrash(path);
      forgetThumbnail(path);
      useLibrary.getState().removeCurrent();
      toast("已移至回收站");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },

  async reveal() {
    const path = currentPath();
    if (path) await revealItemInDir(path).catch((e) => toast(errorMessage(e), "error"));
  },

  async copyPath() {
    const path = currentPath();
    if (!path) return;
    await navigator.clipboard.writeText(path);
    toast("已复制文件路径");
  },
};

export const windowActions = {
  async toggleFullscreen() {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  },
  async exitFullscreen() {
    const win = getCurrentWindow();
    if (await win.isFullscreen()) await win.setFullscreen(false);
  },
};
