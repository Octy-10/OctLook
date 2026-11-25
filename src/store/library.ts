import { create } from "zustand";

import { api, type FileEntry } from "../lib/ipc";

interface LibraryState {
  dir: string | null;
  entries: FileEntry[];
  index: number;
  /** Opens a file (or folder) and lists its supported siblings. */
  open(path: string): Promise<void>;
  go(index: number): void;
  step(delta: number): void;
  /** Drops the current entry after it was deleted on disk. */
  removeCurrent(): void;
}

const normalize = (p: string) => p.replace(/[\/]+/g, "/").toLowerCase();

export const useLibrary = create<LibraryState>((set, get) => ({
  dir: null,
  entries: [],
  index: -1,

  async open(path) {
    const { dir, entries } = await api.listFolder(path);
    const target = normalize(path);
    const found = entries.findIndex((e) => normalize(e.path) === target);
    if (entries.length === 0) throw new Error("该位置没有可预览的文件");
    if (found < 0 && normalize(dir) !== target) throw new Error("不支持此文件格式");
    set({ dir, entries, index: Math.max(found, 0) });
  },

  go(index) {
    const { entries } = get();
    if (entries.length) set({ index: Math.min(entries.length - 1, Math.max(0, index)) });
  },

  step(delta) {
    const { entries, index } = get();
    if (entries.length) set({ index: (index + delta + entries.length) % entries.length });
  },

  removeCurrent() {
    const { entries, index } = get();
    const next = entries.filter((_, i) => i !== index);
    set({ entries: next, index: next.length ? Math.min(index, next.length - 1) : -1 });
  },
}));

export const useCurrentEntry = () => useLibrary((s) => s.entries[s.index] ?? null);
