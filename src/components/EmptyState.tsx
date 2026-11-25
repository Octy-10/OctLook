import { FolderOpen, ImagePlus } from "lucide-react";

import { fileActions } from "../lib/actions";
import { delay } from "../lib/motion";
import { keys } from "../lib/platform";
import motion from "../styles/motion.module.css";
import styles from "./EmptyState.module.css";
import { HeroMotion } from "./HeroMotion";

const FORMATS = [
  "PSD", "PSB", "AI", "PDF", "EPS", "CDR", "SKETCH", "XD", "FIG", "INDD", "AFDESIGN", "KRA",
  "RAW", "DNG", "HEIC", "AVIF", "WEBP", "SVG", "TIFF", "EXR", "HDR", "GIF", "PNG", "JPG",
];

const SHORTCUTS: [string, string][] = [
  ["← →", "切换"],
  ["滚轮", "缩放"],
  ["0 / 1", "适应 / 原始"],
  ["X", "裁剪"],
  ["A", "标注"],
  ["E", "调色"],
  ["O", "提取文字"],
  ["C", "取色"],
  ["Ctrl S", "导出"],
];

export function EmptyState() {
  return (
    <section className={styles.empty}>
      <div className={styles.inner}>
        <div>
          <p className={`${styles.eyebrow} ${motion.fade}`}>OctLook — Image Viewer</p>
          <h1 className={styles.headline}>
            <span className={styles.line}>
              <span className={motion.reveal} style={delay(80)}>
                拖入文件，
              </span>
            </span>
            <span className={styles.line}>
              <span className={motion.reveal} style={delay(190)}>
                <em>即刻</em>看见每一个像素。
              </span>
            </span>
          </h1>
          <p className={`${styles.lede} ${motion.rise}`} style={delay(380)}>
            为设计师打造的看图工具：PSD、AI、CDR 与相机 RAW 原生预览，日常图片同样轻快。
          </p>

          <div className={`${styles.actions} ${motion.rise}`} style={delay(480)}>
            <button className={styles.primary} onClick={() => fileActions.openDialog()}>
              <ImagePlus size={16} /> 打开文件 <kbd>{keys("Ctrl O")}</kbd>
            </button>
            <button className={styles.secondary} onClick={() => fileActions.openDialog(true)}>
              <FolderOpen size={16} /> 打开文件夹
            </button>
          </div>

          <ul className={styles.formats} aria-label="支持的格式">
            {FORMATS.map((f, i) => (
              <li key={f} className={motion.pop} style={delay(620 + i * 22)}>
                {f}
              </li>
            ))}
          </ul>

          <ul className={`${styles.shortcuts} ${motion.fade}`} style={delay(1200)}>
            {SHORTCUTS.map(([k, label]) => (
              <li key={k}>
                <kbd>{keys(k)}</kbd>
                {label}
              </li>
            ))}
          </ul>
        </div>
        <HeroMotion className={styles.art} />
      </div>
    </section>
  );
}
