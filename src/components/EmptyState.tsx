import { FolderOpen, ImagePlus } from "lucide-react";

import { fileActions } from "../lib/actions";
import { keys } from "../lib/platform";
import styles from "./EmptyState.module.css";

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
        <p className={styles.eyebrow}>OctLook — Image Viewer</p>
        <h1 className={styles.headline}>
          拖入文件，
          <br />
          <em>即刻</em>看见每一个像素。
        </h1>
        <p className={styles.lede}>为设计师打造的看图工具：PSD、AI、CDR 与相机 RAW 原生预览，日常图片同样轻快。</p>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => fileActions.openDialog()}>
            <ImagePlus size={16} /> 打开文件 <kbd>{keys("Ctrl O")}</kbd>
          </button>
          <button className={styles.secondary} onClick={() => fileActions.openDialog(true)}>
            <FolderOpen size={16} /> 打开文件夹
          </button>
        </div>

        <ul className={styles.formats} aria-label="支持的格式">
          {FORMATS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>

        <ul className={styles.shortcuts}>
          {SHORTCUTS.map(([k, label]) => (
            <li key={k}>
              <kbd>{keys(k)}</kbd>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
