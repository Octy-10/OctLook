import { FolderOpen, ImagePlus } from "lucide-react";

import hero from "../assets/hero.mp4";
import { fileActions } from "../lib/actions";
import styles from "./EmptyState.module.css";

export function EmptyState() {
  // With reduced motion the film stays on one frame: the folder of thumbnails.
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <section className={styles.empty}>
      <video
        className={styles.film}
        src={still ? `${hero}#t=8` : hero}
        autoPlay={!still}
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden
      />
      <div className={styles.dock}>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => fileActions.openDialog()}>
            <ImagePlus size={16} /> 打开文件
          </button>
          <button className={styles.secondary} onClick={() => fileActions.openDialog(true)}>
            <FolderOpen size={16} /> 打开文件夹
          </button>
        </div>
        <span className={styles.hint}>或直接拖入文件</span>
      </div>
    </section>
  );
}
