import { useEffect, type RefObject } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { api } from "../lib/ipc";
import { exifOrientation } from "../lib/viewport";
import type { Source } from "../lib/source";
import { useLibrary } from "../store/library";
import type { SourceState } from "./useSource";

/** Window content for files without a size of their own (CSS px). */
const SIZES = { audio: [480, 480], text: [820, 900], font: [960, 680], none: [560, 360] } as const;

const basename = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

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
 * Drives the Space preview window: the backend hands it one file at a time
 * (`quicklook:open`) and hides it again (`quicklook:close`). Each file is shown
 * through the library store, as a folder of one, so every viewer works as in
 * the main window. Once loaded, the window is sized to the file and shown.
 */
export function usePreviewWindow({ source, loading, error }: SourceState, bar: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const listeners = [
      win.listen<string>("quicklook:open", ({ payload: path }) =>
        useLibrary.setState({ dir: null, entries: [{ path, name: basename(path), size: 0, modified: 0 }], index: 0 }),
      ),
      win.listen("quicklook:close", () => useLibrary.getState().close()),
    ];
    // Once clicked, the preview has the keyboard: Space and Esc still close it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Escape") return;
      e.preventDefault();
      void api.quicklookClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      listeners.forEach((off) => void off.then((f) => f()));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const path = useLibrary((s) => s.entries[0]?.path ?? null);
  useEffect(() => {
    if (!path || loading) return;
    let alive = true;
    void naturalSize(error ? null : source).then(([width, height]) => {
      if (alive) void api.quicklookPresent(width, height + (bar.current?.offsetHeight ?? 0));
    });
    return () => {
      alive = false;
    };
  }, [path, source, loading, error, bar]);
}
