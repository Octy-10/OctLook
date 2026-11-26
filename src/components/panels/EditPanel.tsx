import { ClipboardCopy, RotateCcw, Save, SplitSquareHorizontal } from "lucide-react";

import { editActions } from "../../lib/actions";
import { isNeutral, NEUTRAL, type Adjustments } from "../../lib/edits";
import { keys } from "../../lib/platform";
import { EXPORT_FORMATS } from "../../lib/render";
import { useEditState, type ExportFormat } from "../../store/edit";
import { Panel } from "./Panel";
import shell from "./Panel.module.css";
import styles from "./EditPanel.module.css";

type Numeric = { [K in keyof Adjustments]: Adjustments[K] extends number ? K : never }[keyof Adjustments];
type Flag = Exclude<keyof Adjustments, Numeric>;

const SLIDERS: [key: Numeric, label: string, range: number][] = [
  ["exposure", "曝光", 100],
  ["contrast", "对比度", 100],
  ["saturation", "饱和度", 100],
  ["temperature", "色温", 100],
  ["tint", "色调", 100],
  ["hue", "色相", 180],
];
const FLAGS: [key: Flag, label: string][] = [
  ["grayscale", "黑白"],
  ["invert", "反相"],
];

function Slider(props: { label: string; value: number; min: number; max: number; neutral: number; onChange(value: number): void }) {
  const changed = props.value !== props.neutral;
  const reset = () => props.onChange(props.neutral);
  return (
    <label className={styles.slider} onDoubleClick={reset} data-changed={changed || undefined}>
      <span>{props.label}</span>
      <output>{props.value}</output>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
        onPointerUp={(e) => e.currentTarget.blur()} // hand the arrow keys back to navigation
      />
      {/* After the input in DOM order, so the label still controls the slider; placed beside the value by the grid. */}
      <button
        className={styles.reset}
        disabled={!changed}
        title={`重置${props.label}`}
        onClick={(e) => {
          e.preventDefault();
          reset();
        }}
      >
        <RotateCcw size={12} />
      </button>
    </label>
  );
}

export function EditPanel() {
  const adjust = useEditState((s) => s.adjust);
  const split = useEditState((s) => s.split);
  const options = useEditState((s) => s.exportOptions);
  const { setAdjust, set, setExportOptions } = useEditState.getState();
  const adjusted = !isNeutral(adjust);
  const compare = (comparing: boolean) => () => set({ comparing });

  return (
    <Panel
      title="编辑"
      footer={
        <>
          <button onClick={editActions.copyImage} data-tip={keys("复制图像  Ctrl C")} data-tip-align="start">
            <ClipboardCopy size={13} /> 复制
          </button>
          <button onClick={editActions.export} data-tip={keys("另存为新文件  Ctrl S")} data-tip-align="end">
            <Save size={13} /> 另存为
          </button>
        </>
      }
    >
      <div className={styles.section}>
        {SLIDERS.map(([key, label, range]) => (
          <Slider key={key} label={label} value={adjust[key]} min={-range} max={range} neutral={NEUTRAL[key]} onChange={(v) => setAdjust({ [key]: v })} />
        ))}
        <div className={styles.chips}>
          {FLAGS.map(([key, label]) => (
            <button key={key} data-active={adjust[key] || undefined} onClick={() => setAdjust({ [key]: !adjust[key] })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <h4>前后对比</h4>
      <div className={`${styles.section} ${styles.chips}`}>
        <button disabled={!adjusted} onPointerDown={compare(true)} onPointerUp={compare(false)} onPointerLeave={compare(false)}>
          按住看原图 <kbd>\</kbd>
        </button>
        <button disabled={!adjusted} data-active={(adjusted && split !== null) || undefined} onClick={editActions.toggleSplit}>
          <SplitSquareHorizontal size={13} /> 分屏
        </button>
      </div>

      <h4>另存为</h4>
      <div className={styles.section}>
        <div className={styles.chips}>
          {(Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((format) => (
            <button key={format} data-active={options.format === format || undefined} onClick={() => setExportOptions({ format })}>
              {EXPORT_FORMATS[format].label}
            </button>
          ))}
        </div>
        {EXPORT_FORMATS[options.format].lossy && (
          <Slider
            label="质量"
            value={Math.round(options.quality * 100)}
            min={10}
            max={100}
            neutral={92}
            onChange={(v) => setExportOptions({ quality: v / 100 })}
          />
        )}
        <label className={styles.field}>
          <span>长边像素</span>
          <input
            type="number"
            min={1}
            placeholder="原始尺寸"
            value={options.maxEdge ?? ""}
            onChange={(e) => setExportOptions({ maxEdge: e.target.valueAsNumber > 0 ? Math.round(e.target.valueAsNumber) : null })}
          />
        </label>
        <p className={shell.note}>另存为新文件，不会覆盖原图；PDF / AI 按 300 dpi 栅格化。</p>
      </div>
    </Panel>
  );
}
