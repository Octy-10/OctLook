import { Copy, ScanText } from "lucide-react";

import { editActions } from "../../lib/actions";
import { toast } from "../../store/toast";
import { useTextState } from "../../store/text";
import { Panel } from "./Panel";
import shell from "./Panel.module.css";
import styles from "./TextPanel.module.css";


const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast("已复制全部文字"));

export function TextPanel() {
  const result = useTextState((s) => s.result);
  const text = result.phase === "done" ? result.text : "";

  return (
    <Panel
      title="文字提取"
      footer={
        <>
          <button onClick={editActions.extractText} disabled={result.phase === "running"}>
            <ScanText size={13} /> {result.phase === "idle" ? "开始识别" : "重新识别"}
          </button>
          <button onClick={() => copy(text)} disabled={!text}>
            <Copy size={13} /> 复制全部
          </button>
        </>
      }
    >
      {result.phase === "idle" && <p className={shell.note}>识别当前画面中的中英文文字，支持竖排与倾斜文字；已裁剪时只识别裁剪区域。全程离线</p>}
      {result.phase === "running" && (
        <>
          <p className={shell.note}>正在识别…</p>
          <div className={styles.track}>
            <div />
          </div>
        </>
      )}
      {result.phase === "failed" && <p className={shell.note} data-tone="error">识别失败：{result.message}</p>}
      {result.phase === "done" && (
        <>
          {!text && <p className={shell.note}>未识别到文字</p>}
          {text && result.origin === "embedded" && <p className={shell.note}>来自文档内嵌文本，与原文一致</p>}
          {text && <pre className={styles.text}>{text}</pre>}
        </>
      )}
    </Panel>
  );
}
