import { FileWarning, FolderSearch } from "lucide-react";

import type { Probe } from "../../hooks/useColorProbe";
import { fileActions } from "../../lib/actions";
import styles from "./Stage.module.css";

export function Loupe({ probe }: { probe: Probe }) {
  const [r, g, b, a] = probe.rgba;
  return (
    <div className={styles.loupe} style={{ left: probe.clientX + 18, top: probe.clientY + 18 }}>
      <span className={styles.swatch} style={{ background: `rgba(${r},${g},${b},${a / 255})` }} />
      <span className={styles.hex}>{probe.hex}</span>
      <span className={styles.rgb}>
        {r} {g} {b}
        {a < 255 && ` · ${Math.round((a / 255) * 100)}%`}
      </span>
    </div>
  );
}

export function StageError({ message }: { message: string }) {
  return (
    <div className={styles.error} onPointerDown={(e) => e.stopPropagation()}>
      <FileWarning size={28} strokeWidth={1.5} />
      <h2>无法预览此文件</h2>
      <p>{message}</p>
      <button onClick={fileActions.reveal}>
        <FolderSearch size={14} /> 在资源管理器中显示
      </button>
    </div>
  );
}
