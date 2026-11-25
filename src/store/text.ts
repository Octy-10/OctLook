import { create } from "zustand";

export type TextResult =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; text: string; origin: "embedded" | "ocr" }
  | { phase: "failed"; message: string };

interface TextState {
  result: TextResult;
  /** Identifies the running extraction so stale results are dropped. */
  job: number;
  /** Starts a job and returns its id. */
  begin(): number;
  /** Settles job `id`; ignored once a newer job (or `clear`) superseded it. */
  settle(id: number, result: TextResult): void;
  clear(): void;
}

export const useTextState = create<TextState>((set, get) => ({
  result: { phase: "idle" },
  job: 0,
  begin() {
    const job = get().job + 1;
    set({ job, result: { phase: "running" } });
    return job;
  },
  settle: (id, result) => set((s) => (s.job === id ? { result } : s)),
  clear: () => set((s) => ({ job: s.job + 1, result: { phase: "idle" } })),
}));
