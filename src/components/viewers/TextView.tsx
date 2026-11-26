import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { DocumentSource } from "../../lib/source";
import { highlight, renderMarkdown } from "../../lib/textRender";
import { useCurrentEntry } from "../../store/library";
import styles from "./viewers.module.css";

type Text = Extract<DocumentSource, { kind: "text" }>;

/** Code and plain text with line numbers; Markdown rendered, with a toggle back to its source. */
export function TextView({ source }: { source: Text }) {
  const { text, encoding, truncated } = source.file;
  const entry = useCurrentEntry();
  const markdown = source.meta.format === "Markdown";
  const [raw, setRaw] = useState(false);
  // Plain text first, the highlighted / rendered HTML once its module has loaded.
  const [html, setHtml] = useState<string | null>(null);
  const lines = useMemo(() => text.split("\n").length, [text]);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    const ext = entry?.name.slice(entry.name.lastIndexOf(".") + 1) ?? "";
    (markdown && !raw ? renderMarkdown(text) : highlight(text, ext)).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [text, markdown, raw, entry?.name]);

  return (
    <div className={styles.text}>
      <header className={styles.textBar}>
        <span>{source.meta.format}</span>
        <span>{encoding}</span>
        <span>{lines.toLocaleString()} 行</span>
        {truncated && <span className={styles.warn}>文件较大，仅显示前 2 MB</span>}
        {markdown && (
          <button className={styles.toggle} onClick={() => setRaw(!raw)}>
            {raw ? "预览" : "源码"}
          </button>
        )}
      </header>
      {markdown && !raw ? (
        <article
          className={styles.markdown}
          dangerouslySetInnerHTML={{ __html: html ?? "" }}
          // Links would navigate the app window itself: they open in the browser instead.
          onClick={(e) => {
            const link = (e.target as Element).closest("a");
            if (!link) return;
            e.preventDefault();
            if (/^https?:/.test(link.href)) void openUrl(link.href);
          }}
        />
      ) : (
        <div className={styles.code}>
          <pre className={styles.gutter} aria-hidden>
            {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
          </pre>
          {html === null ? <pre>{text}</pre> : <pre dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      )}
    </div>
  );
}
