/**
 * Imperative app commands shared by the keyboard map, the HUD and menus.
 * They read/write the stores directly so callers stay declarative.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { useEditState } from "../store/edit";
import { useLibrary } from "../store/library";
import { useTextState } from "../store/text";
import { toast } from "../store/toast";
import { useViewState } from "../store/view";
import { finalizeCrop, fullCrop } from "./crop";
import { api, errorMessage } from "./ipc";
import { encodeCanvas, EXPORT_FORMATS, renderEdited } from "./render";
import { getSurface } from "./surface";
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
  rotate: (direction: 1 | -1) => {
    setView((v) => ({ ...v, rotation: (v.rotation + direction * 90 + 360) % 360, x: 0, y: 0 }));
    // A locked crop ratio is an on-screen shape: turning the image turns it too (16:9 → 9:16).
    const { draft, aspect, set } = useEditState.getState();
    if (draft && aspect) set({ aspect: 1 / aspect });
  },
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

  async openWithDefault() {
    const path = currentPath();
    if (path) await api.openWithDefault(path).catch((e) => toast(errorMessage(e), "error"));
  },

  async copyPath() {
    const path = currentPath();
    if (!path) return;
    await navigator.clipboard.writeText(path);
    toast("已复制文件路径");
  },
};

/** OCR input is capped: larger scans cost seconds without reading better. */
const OCR_MAX_EDGE = 4000;

const edit = () => useEditState.getState();

export const editActions = {
  /** Opens the crop tool on the whole image, starting from the applied crop. */
  beginCrop() {
    const surface = getSurface();
    if (!surface) return;
    edit().set({ draft: edit().crop ?? fullCrop(surface.width, surface.height), aspect: null, tool: null, selected: null, editing: null });
    viewActions.fit();
  },
  applyCrop() {
    const surface = getSurface();
    const { draft } = edit();
    if (!surface || !draft) return;
    edit().set({ crop: finalizeCrop(draft, surface.width, surface.height), draft: null });
    viewActions.fit();
  },
  cancelCrop() {
    edit().set({ draft: null });
    viewActions.fit();
  },
  toggleCrop: () => (edit().draft ? editActions.cancelCrop() : editActions.beginCrop()),

  /** Opens the annotation bar (text tool first) or closes it. */
  toggleAnnotate() {
    if (!getSurface()) return;
    if (edit().draft) editActions.cancelCrop();
    edit().set({ tool: edit().tool ? null : "text", selected: null, editing: null });
  },
  removeSelected() {
    edit().checkpoint();
    const { annotations, selected } = edit();
    edit().set({ annotations: annotations.filter((a) => a.id !== selected), selected: null, editing: null });
  },

  toggleSplit: () => edit().set({ split: edit().split === null ? 0.5 : null }),

  /** Back to the file as opened: colour, crop, annotations, rotation and flips. */
  reset() {
    edit().reset();
    setView((v) => ({ ...v, rotation: 0, flipX: false, flipY: false, fit: true }));
  },

  /** Saves the edited image to a new file; the original is never overwritten. */
  async export() {
    const path = currentPath();
    if (!path || !getSurface()) return;
    const { format, quality, maxEdge } = edit().exportOptions;
    const { label, extension, lossy } = EXPORT_FORMATS[format];
    const target = await saveDialog({
      defaultPath: `${path.replace(/\.[^.\\/]+$/, "")}_edited.${extension}`,
      filters: [{ name: label, extensions: [extension] }],
    });
    if (!target) return;
    try {
      const canvas = await renderEdited({ maxEdge, background: format === "jpeg" ? "#fff" : undefined });
      await api.writeFile(target, await encodeCanvas(canvas, format, lossy ? quality : undefined));
      toast(`已保存 ${canvas.width} × ${canvas.height} ${label}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },

  async copyImage() {
    if (!getSurface()) return;
    try {
      // The promise form keeps the clipboard write inside the user gesture.
      const png = renderEdited().then((canvas) => encodeCanvas(canvas));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast("已复制图像");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  },

  /** Embedded text for vector documents, OCR for everything else. */
  async extractText() {
    const surface = getSurface();
    if (!surface) return;
    const text = useTextState.getState();
    const job = text.begin();
    useViewState.getState().setPanel("text");
    try {
      const embedded = (await surface.text?.())?.trim();
      const found =
        embedded ||
        (await api.recognizeText(await renderEdited({ maxEdge: OCR_MAX_EDGE, background: "#fff" })));
      text.settle(job, { phase: "done", text: found, origin: embedded ? "embedded" : "ocr" });
    } catch (e) {
      text.settle(job, { phase: "failed", message: errorMessage(e) });
    }
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
