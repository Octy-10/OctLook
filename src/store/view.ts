import { create } from "zustand";
import { persist } from "zustand/middleware";

import { initialView, type View } from "../lib/viewport";

export type Backdrop = "dark" | "light" | "checker";
const BACKDROPS: Backdrop[] = ["dark", "light", "checker"];
export type Theme = "system" | "dark" | "light";

/** Side panels share one slot: opening one replaces the other. */
export type Panel = "info" | "edit" | "text";

interface ViewState {
  view: View;
  /** Fit-to-window scale for the current content, published by the stage. */
  fitScale: number;
  page: number;
  backdrop: Backdrop;
  theme: Theme;
  filmstrip: boolean;
  panel: Panel | null;
  picker: boolean;
  setView(update: Partial<View> | ((v: View) => View)): void;
  resetView(): void;
  setFitScale(scale: number): void;
  setPage(page: number): void;
  cycleBackdrop(): void;
  setBackdrop(backdrop: Backdrop): void;
  setTheme(theme: Theme): void;
  toggle(flag: "filmstrip" | "picker"): void;
  setPanel(panel: Panel | null): void;
  togglePanel(panel: Panel): void;
}

export const useViewState = create<ViewState>()(
  persist(
    (set) => ({
      view: initialView(),
      fitScale: 1,
      page: 1,
      backdrop: "dark",
      theme: "system",
      filmstrip: true,
      panel: null,
      picker: false,
      setView: (update) => set((s) => ({ view: typeof update === "function" ? update(s.view) : { ...s.view, ...update } })),
      resetView: () => set({ view: initialView(), page: 1 }),
      setFitScale: (fitScale) => set({ fitScale }),
      setPage: (page) => set({ page, view: initialView() }),
      cycleBackdrop: () => set((s) => ({ backdrop: BACKDROPS[(BACKDROPS.indexOf(s.backdrop) + 1) % BACKDROPS.length] })),
      setBackdrop: (backdrop) => set({ backdrop }),
      setTheme: (theme) => set({ theme }),
      toggle: (flag) => set((s) => ({ [flag]: !s[flag] })),
      setPanel: (panel) => set({ panel }),
      togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
    }),
    {
      name: "octlook.preferences",
      version: 1,
      // v0 stored `info: boolean` instead of `panel`.
      migrate: ({ info, ...rest }: any) => ({ ...rest, panel: info ? "info" : null }),
      // Extracted text belongs to one image, so its panel never reopens on launch.
      partialize: ({ backdrop, theme, filmstrip, panel }) => ({ backdrop, theme, filmstrip, panel: panel === "text" ? null : panel }),
    },
  ),
);
