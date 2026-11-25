import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { errorMessage } from "../lib/ipc";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "installing"; progress: number | null }
  | { phase: "failed"; message: string };

/** Deferred so the check never competes with opening the first image. */
const FIRST_CHECK_MS = 6000;

/**
 * Checks GitHub Releases once per launch. Updates are signature-verified by
 * the updater plugin; nothing installs without the user's click.
 */
export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const pending = useRef<Update | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return; // dev builds are not released
    let cancelled = false;
    const timer = setTimeout(() => {
      check()
        .then((update) => {
          if (cancelled || !update) return;
          pending.current = update;
          setState({ phase: "available", version: update.version });
        })
        // Offline or rate-limited: stay quiet, the next launch retries.
        .catch((e) => console.warn("update check failed:", errorMessage(e)));
    }, FIRST_CHECK_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const install = useCallback(async () => {
    const update = pending.current;
    if (!update) return;
    setState({ phase: "installing", progress: null });
    let total = 0;
    let received = 0;
    let shown = -1;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event !== "Progress" || !total) return;
        received += event.data.chunkLength;
        const percent = Math.floor((received / total) * 100);
        if (percent !== shown) {
          shown = percent; // one render per percent, not per chunk
          setState({ phase: "installing", progress: percent / 100 });
        }
      });
      await relaunch(); // Windows exits into the installer before this; other platforms restart here
    } catch (e) {
      setState({ phase: "failed", message: errorMessage(e) });
    }
  }, []);

  const dismiss = useCallback(() => setState({ phase: "idle" }), []);

  return { state, install, dismiss };
}
