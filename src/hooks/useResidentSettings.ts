import { useEffect, useState } from "react";

import { api, errorMessage, type ResidentSettings } from "../lib/ipc";
import { toast } from "../store/toast";

/** Space preview and autostart switches (Windows); null until read. */
export function useResidentSettings() {
  const [settings, setSettings] = useState<ResidentSettings | null>(null);
  useEffect(() => void api.residentSettings().then(setSettings, () => {}), []);
  const apply = (change: Promise<ResidentSettings>) => void change.then(setSettings, (e) => toast(errorMessage(e), "error"));
  return {
    settings,
    toggleSpacePreview: () => settings && apply(api.setSpacePreview(!settings.spacePreview)),
    toggleAutostart: () => settings && apply(api.setAutostart(!settings.autostart)),
  };
}
