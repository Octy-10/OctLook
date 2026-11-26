import { useEffect, useState } from "react";

import { errorMessage } from "../lib/ipc";
import { getSource, retainSources, type Source } from "../lib/source";
import { useLibrary } from "../store/library";

export interface SourceState {
  /** Last successfully loaded source; stays on stage while the next loads. */
  source: Source | null;
  loading: boolean;
  error: string | null;
}

const PREFETCH = [1, -1, 2];

/** Loads the current entry and keeps its neighbours decoded ahead of time. */
export function useSource(): SourceState {
  const path = useLibrary((s) => s.entries[s.index]?.path ?? null);
  const [state, setState] = useState<SourceState>({ source: null, loading: false, error: null });

  useEffect(() => {
    if (!path) {
      retainSources(new Set());
      setState({ source: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));

    getSource(path)
      .then(
        (source) => alive && setState({ source, loading: false, error: null }),
        (e) => alive && setState({ source: null, loading: false, error: errorMessage(e) }),
      )
      .finally(() => {
        if (!alive) return;
        const { entries, index } = useLibrary.getState();
        const neighbours = PREFETCH.map((d) => entries[(index + d + entries.length) % entries.length]?.path).filter(
          (p): p is string => !!p && p !== path,
        );
        retainSources(new Set([path, ...neighbours]));
        for (const p of neighbours) getSource(p).catch(() => {});
      });

    return () => {
      alive = false;
    };
  }, [path]);

  return state;
}
