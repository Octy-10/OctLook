import { useEffect, type RefObject } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { api } from "../lib/ipc";
import { exifOrientation } from "../lib/viewport";
import type { Source } from "../lib/source";
import { useLibrary } from "../store/library";
import type { SourceState } from "./useSource";

/** Window content for files without a size of their own (CSS px). */
const SIZES = { audio: [480, 480], text: [820, 900], font: [960, 680], none: [560, 360] } as const;

declare global {
  interface Window {
    /** Set by the backend before a pinned preview's page runs: the one file it shows. */
    __OCTLOOK_PIN__?: string;
  }
}

/** The file of a pinned preview window; null in the Space preview, which follows Explorer. */
export const pinnedPath = window.__OCTLOOK_PIN__ ?? null;

/** A pinned window closes itself; the Space preview is hidden by the backend, ready for the next file. */
export const closePreview = () => void (pinnedPath ? getCurrentWindow().close() : api.quicklookClose());

const basename = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/** Shows `path` through the library store, as a folder of one, so every viewer works as in the main window. */
const showOnly = (path: string) =>
  useLibrary.setState({ dir: null, entries: [{ path, name: basename(path), size: 0, modified: 0 }], index: 0 });

/** Pixel size of a video, read from its metadata alone. */
const videoSize = (url: string) =>
  new Promise<[number, number]>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve([video.videoWidth || 960, video.videoHeight || 540]);
    video.onerror = () => resolve([960, 540]);
    video.src = url;
  });

/** The size the file would like to be shown at, as the viewer will orient it. */
async function naturalSize(source: Source | null): Promise<readonly [number, number]> {
  switch (source?.kind) {
    case "image":
    case "vector":
    case "bitmap": {
      const turned = exifOrientation(source.meta.orientation).rotation % 180 !== 0;
      return turned ? [source.height, source.width] : [source.width, source.height];
    }
    case "pdf": {
      const { width, height } = (await source.doc.getPage(1)).getViewport({ scale: 1 });
      return [width, height];
    }
    case "video":
      return videoSize(source.url);
    case "audio":
    case "text":
    case "font":
      return SIZES[source.kind];
    default:
      return SIZES.none;
  }
}

/**
 * Drives a preview window. The Space preview gets one file at a time from the
 * backend (`quicklook:open`), is hidden again (`quicklook:close`), and once a
 * file has loaded the window is sized to it and shown. A pinned window shows
 * its one file and is placed by the backend.
 */
export function usePreviewWindow({ source, loading, error }: SourceState, bar: RefObject<HTMLElement | null>) {
  useEffect(() => {
    // Once clicked, a preview has the keyboard: Esc closes it, and Space too while it is the Space preview.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && (pinnedPath || e.key !== " ")) return;
      e.preventDefault();
      closePreview();
    };
    window.addEventListener("keydown", onKey);
    const win = getCurrentWebviewWindow();
    const listeners = pinnedPath
      ? []
      : [
          win.listen<string>("quicklook:open", ({ payload }) => showOnly(payload)),
          win.listen("quicklook:close", () => useLibrary.getState().close()),
        ];
    if (pinnedPath) showOnly(pinnedPath);
    return () => {
      listeners.forEach((off) => void off.then((f) => f()));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const path = useLibrary((s) => s.entries[0]?.path ?? null);
  useEffect(() => {
    if (!path || loading || pinnedPath) return;
    let alive = true;
    void naturalSize(error ? null : source).then(([width, height]) => {
      if (alive) void api.quicklookPresent(width, height + (bar.current?.offsetHeight ?? 0));
    });
    return () => {
      alive = false;
    };
  }, [path, source, loading, error, bar]);
}
