import type { ReactNode } from "react";
import { Copy, FolderSearch, X } from "lucide-react";

import { useAsync } from "../../hooks/useAsync";
import { fileActions } from "../../lib/actions";
import { formatBytes, formatDate } from "../../lib/format";
import { api, type ExifEntry } from "../../lib/ipc";
import type { ImageSource } from "../../lib/source";
import { useCurrentEntry } from "../../store/library";
import { useViewState } from "../../store/view";
import styles from "./InfoPanel.module.css";

const EXIF_LABEL: Record<ExifEntry["key"], string> = {
  make: "品牌",
  model: "机型",
  lens: "镜头",
  aperture: "光圈",
  shutter: "快门",
  iso: "ISO",
  focal: "焦距",
  taken: "拍摄时间",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function dimensions(source: ImageSource): string {
  if (source.kind === "pdf") return `${source.pages} 页 · 矢量`;
  const size = `${source.width} × ${source.height}`;
  const original = source.meta.originalSize;
  return original ? `${original[0]} × ${original[1]}（显示 ${size}）` : size;
}

export function InfoPanel({ source }: { source: ImageSource | null }) {
  const entry = useCurrentEntry();
  const toggle = useViewState((s) => s.toggle);
  const info = useAsync(entry?.path ?? null, api.fileInfo);
  if (!entry) return null;

  return (
    <aside className={styles.panel} onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <h3>{entry.name}</h3>
        <button className={styles.icon} aria-label="关闭" onClick={() => toggle("info")}>
          <X size={14} />
        </button>
      </header>

      <dl>
        {source && (
          <>
            <Row label="格式">{source.meta.detail ? `${source.meta.format} · ${source.meta.detail}` : source.meta.format}</Row>
            <Row label="尺寸">{dimensions(source)}</Row>
            <Row label="渲染">{source.meta.source === "full" ? "完整渲染" : "内嵌预览"}</Row>
          </>
        )}
        <Row label="大小">{formatBytes(entry.size)}</Row>
        <Row label="修改">{formatDate(entry.modified)}</Row>
        {info?.created != null && <Row label="创建">{formatDate(info.created)}</Row>}
      </dl>

      {info && info.exif.length > 0 && (
        <>
          <h4>拍摄参数</h4>
          <dl>
            {info.exif.map((e) => (
              <Row key={e.key} label={EXIF_LABEL[e.key]}>
                {e.value}
              </Row>
            ))}
          </dl>
        </>
      )}

      <footer>
        <button onClick={fileActions.copyPath}>
          <Copy size={13} /> 复制路径
        </button>
        <button onClick={fileActions.reveal}>
          <FolderSearch size={13} /> 在文件夹中显示
        </button>
      </footer>
    </aside>
  );
}
