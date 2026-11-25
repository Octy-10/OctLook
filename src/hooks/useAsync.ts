import { useEffect, useState } from "react";

/**
 * Resolves `load()` whenever `key` changes; stale results are discarded.
 * Returns undefined while pending (or when key is null) and null on failure.
 */
export function useAsync<T>(key: string | null, load: (key: string) => Promise<T>): T | null | undefined {
  const [state, setState] = useState<{ key: string | null; value: T | null | undefined }>({ key: null, value: undefined });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    load(key).then(
      (value) => alive && setState({ key, value }),
      () => alive && setState({ key, value: null }),
    );
    return () => {
      alive = false;
    };
  }, [key]); // `load` is a stable module-level function at every call site.
  return state.key === key ? state.value : undefined;
}
