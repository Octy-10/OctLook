import { create } from "zustand";
import { persist } from "zustand/middleware";

import { INK_COLORS, type Annotation, type Ink, type Tool } from "../lib/annotate";
import type { Crop } from "../lib/crop";
import { isNeutral, NEUTRAL, type Adjustments } from "../lib/edits";

export type ExportFormat = "png" | "jpeg" | "webp";

export interface ExportOptions {
  format: ExportFormat;
  /** 0 … 1, lossy formats only. */
  quality: number;
  /** Longest edge in px; null keeps the original resolution. */
  maxEdge: number | null;
}

/** Edits of the current image; dropped together by `reset`. */
interface Edits {
  adjust: Adjustments;
  /** Applied crop in content px; null shows the whole image. */
  crop: Crop | null;
  /** Rectangle being drawn; non-null means the crop tool is open. */
  draft: Crop | null;
  /** Locked on-screen aspect ratio (width / height) of the crop tool. */
  aspect: number | null;
  annotations: Annotation[];
  /** Active annotation tool; non-null means the annotation bar is open. */
  tool: Tool | null;
  /** Id of the selected annotation. */
  selected: string | null;
  /** Id of the text annotation being typed into, in place. */
  editing: string | null;
  /** Momentarily shows the image without colour adjustments. */
  comparing: boolean;
  /** Divider position (0 … 1) of the before / after split; null when off. */
  split: number | null;
  /** Annotation lists before each change (oldest first) and after each undo. */
  past: Annotation[][];
  future: Annotation[][];
}

interface EditState extends Edits {
  /** Colour and size given to new annotations. */
  ink: Ink;
  exportOptions: ExportOptions;
  setAdjust(patch: Partial<Adjustments>): void;
  set(patch: Partial<Edits & Pick<EditState, "ink">>): void;
  setExportOptions(patch: Partial<ExportOptions>): void;
  /** Drops every edit of the current image; preferences stay. */
  reset(): void;
  /** Records the annotations as they are, before a change the user can undo. */
  checkpoint(): void;
  undo(): void;
  redo(): void;
  /**
   * Switches to the image (or page) `key`: the current edits are kept for
   * the session and the new image's own edits, if any, come back.
   */
  open(key: string): void;
}

const PRISTINE: Edits = {
  adjust: NEUTRAL,
  crop: null,
  draft: null,
  aspect: null,
  annotations: [],
  tool: null,
  selected: null,
  editing: null,
  comparing: false,
  split: null,
  past: [],
  future: [],
};

/** Edits that outlive the tool session; the rest (tools, selection, comparison) start fresh. */
const lasting = ({ adjust, crop, annotations, past, future }: Edits): Partial<Edits> => ({ adjust, crop, annotations, past, future });
const isPristine = (e: Edits) => e.crop === null && e.annotations.length === 0 && e.past.length === 0 && isNeutral(e.adjust);
/** Same annotations: they are immutable, so equal references mean equal content. */
const same = (a: Annotation[], b: Annotation[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const stash = new Map<string, Partial<Edits>>();
let openKey: string | null = null;

export const useEditState = create<EditState>()(
  persist(
    (set) => ({
      ...PRISTINE,
      ink: { color: INK_COLORS[0], textScale: 1, strokeScale: 1 },
      exportOptions: { format: "png", quality: 0.92, maxEdge: null },
      setAdjust: (patch) => set((s) => ({ adjust: { ...s.adjust, ...patch } })),
      set,
      setExportOptions: (patch) => set((s) => ({ exportOptions: { ...s.exportOptions, ...patch } })),
      reset: () => set(PRISTINE),
      checkpoint: () =>
        set((s) => (s.past.length && same(s.past[s.past.length - 1], s.annotations) ? s : { past: [...s.past, s.annotations], future: [] })),
      undo: () =>
        set((s) => {
          // Checkpoints of presses that changed nothing are skipped.
          const past = [...s.past];
          while (past.length && same(past[past.length - 1], s.annotations)) past.pop();
          const annotations = past.pop();
          return annotations ? { annotations, past, future: [...s.future, s.annotations], selected: null, editing: null } : { past };
        }),
      redo: () =>
        set((s) => {
          const annotations = s.future[s.future.length - 1];
          return annotations ? { annotations, past: [...s.past, s.annotations], future: s.future.slice(0, -1), selected: null, editing: null } : s;
        }),
      open(key) {
        if (key === openKey) return;
        const current = useEditState.getState();
        if (openKey !== null) {
          if (isPristine(current)) stash.delete(openKey);
          else stash.set(openKey, lasting(current));
        }
        openKey = key;
        set({ ...PRISTINE, ...stash.get(key) });
      },
    }),
    {
      name: "octlook.export",
      version: 1,
      // v0 kept a single `ink.scale`; the default ink replaces it.
      migrate: ({ exportOptions }: any) => ({ exportOptions }),
      partialize: ({ exportOptions, ink }) => ({ exportOptions, ink }),
    },
  ),
);
