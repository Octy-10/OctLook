import { AppWindow, type LucideProps } from "lucide-react";

import { useDefaultApp } from "../../hooks/useDefaultApp";
import { api, errorMessage } from "../../lib/ipc";
import { toast } from "../../store/toast";
import styles from "./TitleBar.module.css";

/**
 * Title-bar button that opens `path` in the app recommended for its type
 * (Photoshop for a PSD…), shown only when there is one; any other app is a
 * right-click away ("Open with"). `onOpened` runs once the app took the file.
 */
export function OpenElsewhere({ path, icon, onOpened }: { path: string; icon: LucideProps; onOpened?: () => void }) {
  const app = useDefaultApp(path);
  if (!app) return null;
  const label = `用 ${app.name} 打开`;
  const open = () => void api.openWithDefault(path).then(onOpened, (e) => toast(errorMessage(e), "error"));
  return (
    <button aria-label={label} data-tip={label} data-tip-side="bottom" onClick={open}>
      {app.icon ? <img className={styles.appIcon} src={app.icon} alt="" draggable={false} /> : <AppWindow {...icon} />}
    </button>
  );
}
