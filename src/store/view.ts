import { create } from "zustand";
import { persist } from "zustand/middleware";

import { initialView, type View } from "../lib/viewport";

export type Backdrop = "dark" | "light" | "checker";
const BACKDROPS: Backdrop[] = ["dark", "light", "checker"];

interface ViewState {
  view: View;
  /** Fit-to-window scale for the current content, published by the stage. */
  fitScale: number;
  page: number;
  backdrop: Backdrop;
  filmstrip: boolean;
  info: boolean;
  picker: boolean;
  setView(update: Partial<View> | ((v: View) => View)): void;
  resetView(): void;
  setFitScale(scale: number): void;
  setPage(page: number): void;
  cycleBackdrop(): void;
  toggle(panel: "filmstrip" | "info" | "picker"): void;
}

export const useViewState = create<ViewState>()(
  persist(
    (set) => ({
      view: initialView(),
      fitScale: 1,
      page: 1,
      backdrop: "dark",
      filmstrip: true,
      info: false,
      picker: false,
      setView: (update) => set((s) => ({ view: typeof update === "function" ? update(s.view) : { ...s.view, ...update } })),
      resetView: () => set({ view: initialView(), page: 1 }),
      setFitScale: (fitScale) => set({ fitScale }),
      setPage: (page) => set({ page, view: initialView() }),
      cycleBackdrop: () => set((s) => ({ backdrop: BACKDROPS[(BACKDROPS.indexOf(s.backdrop) + 1) % BACKDROPS.length] })),
      toggle: (panel) => set((s) => ({ [panel]: !s[panel] })),
    }),
    {
      name: "octlook.preferences",
      partialize: ({ backdrop, filmstrip, info }) => ({ backdrop, filmstrip, info }),
    },
  ),
);
