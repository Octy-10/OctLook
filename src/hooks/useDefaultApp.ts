import { api, type DefaultApp } from "../lib/ipc";
import { useAsync } from "./useAsync";

export interface AppLink {
  id: string;
  name: string;
  /** Object URL of the app icon; kept for the session (one per file type). */
  icon: string | null;
}

const link = (app: DefaultApp): AppLink => ({
  id: app.id,
  name: app.name,
  icon: app.icon.length ? URL.createObjectURL(new Blob([new Uint8Array(app.icon)], { type: "image/png" })) : null,
});

/** Associations are per file type: each is looked up once per extension. */
function perExtension<T>(fetch: (path: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  return (path: string) => {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    let hit = cache.get(ext);
    if (!hit) {
      cache.set(ext, (hit = fetch(path)));
      hit.catch(() => cache.delete(ext)); // a failed lookup is tried again next time
    }
    return hit;
  };
}

const recommended = perExtension((path) => api.defaultApp(path).then((app) => app && link(app)));
const choices = perExtension((path) => api.openWithApps(path).then((apps) => apps.map(link)));

/** The app that edits `path` (Photoshop for a PSD…); null for files OctLook fully serves or when none is installed. */
export const useDefaultApp = (path: string | null) => useAsync(path, recommended);

/** Every app Windows offers to open `path` with ("Open with"), the default first. */
export const useOpenWithApps = (path: string | null) => useAsync(path, choices);
