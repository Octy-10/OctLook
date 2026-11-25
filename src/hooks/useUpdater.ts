import { useEffect } from "react";

import { useUpdate } from "../store/update";

/** How long after launch the one check runs, so it never competes with opening the first image. */
const FIRST_CHECK_MS = 6000;

/**
 * The only automatic check: one request per launch, never repeated while the
 * app runs (other checks come from the "检查更新" button). It downloads a
 * static `latest.json` from GitHub Releases, which is not rate-limited like
 * the REST API. Dev builds are not released, so they skip it.
 */
export function useLaunchUpdateCheck() {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const timer = setTimeout(() => void useUpdate.getState().check(false), FIRST_CHECK_MS);
    return () => clearTimeout(timer);
  }, []);
}
