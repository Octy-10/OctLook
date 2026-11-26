import { api } from "../lib/ipc";
import { useAsync } from "./useAsync";

export interface AppLink {
  name: string;
  /** Object URL of the app icon; kept for the session (one per file type). */
  icon: string | null;
}

/** Associations are per file type: looked up once per extension. */
const byExtension = new Map<string, Promise<AppLink | null>>();

function lookup(path: string): Promise<AppLink | null> {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  let hit = byExtension.get(ext);
  if (!hit) {
    hit = api.defaultApp(path).then(
      (app) =>
        app && {
          name: app.name,
          icon: app.icon.length ? URL.createObjectURL(new Blob([new Uint8Array(app.icon)], { type: "image/png" })) : null,
        },
    );
    byExtension.set(ext, hit);
  }
  return hit;
}

/** The app that edits `path` (Photoshop for a PSD…); null for files OctLook fully serves or when none is installed. */
export const useDefaultApp = (path: string | null) => useAsync(path, lookup);
