import { useEffect, useState, type RefObject } from "react";

export function useElementSize(ref: RefObject<HTMLElement | null>): [number, number] {
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize([width, height]);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
