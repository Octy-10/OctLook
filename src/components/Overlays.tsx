import { useToast } from "../store/toast";
import styles from "./Overlays.module.css";

export function DropOverlay() {
  return (
    <div className={styles.drop}>
      <div className={styles.dropFrame}>
        <p>松开以打开</p>
        <span>文件或文件夹</span>
      </div>
    </div>
  );
}

export function Toaster() {
  const toasts = useToast((s) => s.toasts);
  return (
    <div className={styles.toaster} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} data-tone={t.tone}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
