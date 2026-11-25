import { useEffect, useState } from "react";

/** Delay before going idle once the pointer has left the window. */
const LEFT_MS = 300;

/** True after `ms` without pointer or keyboard activity, or shortly after the pointer leaves the window. */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    const leave = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), LEFT_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    wake();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, wake));
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [ms]);
  return idle;
}
