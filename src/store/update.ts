import { create } from "zustand";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { errorMessage } from "../lib/ipc";
import { toast } from "./toast";

export type UpdatePhase =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string }
  | { phase: "installing"; progress: number | null }
  | { phase: "failed"; message: string };

interface UpdateState {
  state: UpdatePhase;
  /** Queries GitHub Releases. `manual` reports every outcome; the launch check stays silent unless there is an update. */
  check(manual: boolean): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
}

/** The release found by the last check; installed only on the user's click. Signatures are verified by the plugin. */
let pending: Update | null = null;

export const useUpdate = create<UpdateState>((set, get) => ({
  state: { phase: "idle" },

  async check(manual) {
    const { phase } = get().state;
    if (phase === "checking" || phase === "installing") return;
    set({ state: { phase: "checking" } });
    try {
      pending = await check();
      set({ state: pending ? { phase: "available", version: pending.version } : { phase: "idle" } });
      if (!pending && manual) toast("已是最新版本");
    } catch (e) {
      set({ state: { phase: "idle" } });
      // Offline or rate-limited at launch: stay quiet, the next launch retries.
      if (manual) toast(`检查更新失败：${errorMessage(e)}`, "error");
      else console.warn("update check failed:", errorMessage(e));
    }
  },

  async install() {
    if (!pending) return;
    set({ state: { phase: "installing", progress: null } });
    let total = 0;
    let received = 0;
    let shown = -1;
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event !== "Progress" || !total) return;
        received += event.data.chunkLength;
        const percent = Math.floor((received / total) * 100);
        if (percent !== shown) {
          shown = percent; // one render per percent, not per chunk
          set({ state: { phase: "installing", progress: percent / 100 } });
        }
      });
      await relaunch(); // Windows exits into the installer before this; other platforms restart here
    } catch (e) {
      set({ state: { phase: "failed", message: errorMessage(e) } });
    }
  },

  dismiss: () => set({ state: { phase: "idle" } }),
}));
