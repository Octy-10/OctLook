import { create } from "zustand";

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

interface ToastState {
  toasts: Toast[];
  show(message: string, tone?: Toast["tone"]): void;
}

let seq = 0;

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show(message, tone = "info") {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === "error" ? 4200 : 2200);
  },
}));

export const toast = (message: string, tone?: Toast["tone"]) => useToast.getState().show(message, tone);
