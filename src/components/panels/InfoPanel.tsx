import type { ReactNode } from "react";
import { Copy, FolderSearch } from "lucide-react";

import { useAsync } from "../../hooks/useAsync";
import { usePalette } from "../../hooks/usePalette";
import { fileActions } from "../../lib/actions";
import { formatBytes, formatDate } from "../../lib/format";
import { api, type ExifEntry } from "../../lib/ipc";
import type { ImageSource } from "../../lib/source";
import { useCurrentEntry } from "../../store/library";
import { toast } from "../../store/toast";
import { Panel } from "./Panel";
import styles from "./Panel.module.css";

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

const PRINT_DPI = 300;
const toCm = (px: number) => ((px / PRINT_DPI) * 2.54).toFixed(1);

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

/** Physical size at print resolution; meaningless for vector documents. */
function printSize(source: ImageSource): string | null {
  if (source.kind === "pdf") return null;
  const [w, h] = source.meta.originalSize ?? [source.width, source.height];
  return `${toCm(w)} × ${toCm(h)} cm @ ${PRINT_DPI} dpi`;
}

const copyColor = (hex: string) => void navigator.clipboard.writeText(hex).then(() => toast(`已复制 ${hex}`));

export function InfoPanel({ source }: { source: ImageSource | null }) {
  const entry = useCurrentEntry();
  const info = useAsync(entry?.path ?? null, api.fileInfo);
  const palette = usePalette(source);
  if (!entry) return null;
  const print = source && printSize(source);

  return (
    <Panel
      title={entry.name}
      footer={
        <>
          <button onClick={fileActions.copyPath}>
            <Copy size={13} /> 复制路径
          </button>
          <button onClick={fileActions.reveal}>
            <FolderSearch size={13} /> 在文件夹中显示
          </button>
        </>
      }
    >
      <dl>
        {source && (
          <>
            <Row label="格式">{source.meta.detail ? `${source.meta.format} · ${source.meta.detail}` : source.meta.format}</Row>
            <Row label="尺寸">{dimensions(source)}</Row>
            {print && <Row label="印刷">{print}</Row>}
            <Row label="渲染">{source.meta.source === "full" ? "完整渲染" : "内嵌预览"}</Row>
          </>
        )}
        <Row label="大小">{formatBytes(entry.size)}</Row>
        <Row label="修改">{formatDate(entry.modified)}</Row>
        {info?.created != null && <Row label="创建">{formatDate(info.created)}</Row>}
      </dl>

      {palette.length > 0 && (
        <>
          <h4>主色</h4>
          <div className={styles.palette}>
            {palette.map((hex) => (
              <button key={hex} style={{ background: hex }} data-tip={hex} aria-label={`复制 ${hex}`} onClick={() => copyColor(hex)} />
            ))}
          </div>
        </>
      )}

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
    </Panel>
  );
}
