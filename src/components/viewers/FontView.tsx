import { useState } from "react";

import type { DocumentSource } from "../../lib/source";
import { useCurrentEntry } from "../../store/library";
import styles from "./viewers.module.css";

type Font = Extract<DocumentSource, { kind: "font" }>;

const SIZES = [96, 64, 48, 32, 24, 16, 12];
const LATIN = "The quick brown fox jumps over the lazy dog 0123456789";
const CJK = "永字八法 设计稿，一眼看透。";
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !@#$%&*()[]{}<>?/";

/** Specimen sheet: the font's names, a size ladder of editable sample text and its character set. */
export function FontView({ source }: { source: Font }) {
  const { info, family } = source;
  const entry = useCurrentEntry();
  const [sample, setSample] = useState(info?.cjk ? `${CJK} ${LATIN}` : LATIN);
  const details = [
    info?.style,
    info?.version,
    info && `${info.glyphs.toLocaleString()} 个字形`,
    info && info.faces > 1 && `集合内 ${info.faces} 款（显示第 1 款）`,
    info && (info.cjk ? "含中文字形" : "不含中文字形"),
  ].filter(Boolean);
  const face = { fontFamily: `"${family}", var(--font)` };

  return (
    <div className={styles.font}>
      <header>
        <h1 style={face}>{info?.family ?? entry?.name}</h1>
        <p>
          {source.meta.format}
          {details.map((d) => ` · ${d}`)}
        </p>
        {info?.designer && <p>{info.designer}</p>}
        <input
          className={styles.sample}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="输入文字预览字体"
          aria-label="样张文字"
          spellCheck={false}
        />
      </header>
      <ol>
        {SIZES.map((size) => (
          <li key={size}>
            <span>{size}</span>
            <div style={{ ...face, fontSize: size }}>{sample || " "}</div>
          </li>
        ))}
      </ol>
      <p className={styles.charset} style={face}>
        {CHARSET}
        {info?.cjk && ` ${CJK}`}
      </p>
    </div>
  );
}
