import { useEffect, useState } from "react";

import { extractPalette } from "../lib/palette";
import type { ImageSource } from "../lib/source";

const NONE: string[] = [];

/** Dominant colours of `source`; empty while computing and for vector documents. */
export function usePalette(source: ImageSource | null): string[] {
  const [state, setState] = useState<{ source: ImageSource; colors: string[] } | null>(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    extractPalette(source).then(
      (colors) => alive && setState({ source, colors }),
      () => {}, // undecodable for canvas use: simply no palette
    );
    return () => {
      alive = false;
    };
  }, [source]);
  return state?.source === source ? state.colors : NONE;
}
