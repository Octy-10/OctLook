import { useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  ClipboardCopy,
  Copy,
  Expand,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  FolderSearch,
  ImagePlus,
  Info,
  Maximize,
  RotateCcw,
  Scan,
  Trash2,
} from "lucide-react";

import { useAsync } from "../../hooks/useAsync";
import { editActions, fileActions, viewActions, windowActions } from "../../lib/actions";
import { useUpdate } from "../../store/update";
import { useViewState, type Backdrop, type Theme } from "../../store/view";
import { MENU_ICON as ICON, MenuItem as Item, useMenuDismiss } from "./Menu";
import styles from "./Menu.module.css";

const BACKDROPS: [Backdrop, string][] = [["dark", "深色"], ["light", "浅色"], ["checker", "网格"]];
const THEMES: [Theme, string][] = [["system", "跟随系统"], ["dark", "深色"], ["light", "浅色"]];

function Segmented<T extends string>(props: { label: string; options: [T, string][]; value: T; onChange(value: T): void }) {
  return (
    <div className={styles.field}>
      <span>{props.label}</span>
      <div className={styles.segments}>
        {props.options.map(([value, label]) => (
          <button key={value} data-active={props.value === value || undefined} onClick={() => props.onChange(value)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Everything that is not a primary tool: secondary commands, view and system preferences. */
export function SettingsMenu({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useViewState((s) => s.backdrop);
  const theme = useViewState((s) => s.theme);
  const panel = useViewState((s) => s.panel);
  const { setBackdrop, setTheme, togglePanel } = useViewState.getState();
  const version = useAsync("version", getVersion);
  const checking = useUpdate((s) => s.state.phase === "checking");

  useMenuDismiss(() => ref.current?.parentElement, onClose); // the menu and its toggle

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      onClick={(e) => (e.target as Element).closest("[data-dismiss]") && onClose()}
    >
      <h5>工具</h5>
      <Item icon={<ClipboardCopy {...ICON} />} label="复制图像" shortcut="Ctrl C" onSelect={editActions.copyImage} />
      <Item icon={<Info {...ICON} />} label="文件信息" shortcut="I" checked={panel === "info"} onSelect={() => togglePanel("info")} />

      <h5>变换</h5>
      <Item icon={<RotateCcw {...ICON} />} label="向左旋转" shortcut="Shift R" keepOpen onSelect={() => viewActions.rotate(-1)} />
      <Item icon={<FlipHorizontal2 {...ICON} />} label="水平翻转" shortcut="H" keepOpen onSelect={viewActions.flipX} />
      <Item icon={<FlipVertical2 {...ICON} />} label="垂直翻转" shortcut="V" keepOpen onSelect={viewActions.flipY} />

      <h5>显示</h5>
      <Item icon={<Scan {...ICON} />} label="适应窗口" shortcut="0" onSelect={viewActions.fit} />
      <Item icon={<Maximize {...ICON} />} label="实际大小" shortcut="1" onSelect={viewActions.actualSize} />
      <Segmented label="画布背景" options={BACKDROPS} value={backdrop} onChange={setBackdrop} />
      <Segmented label="界面外观" options={THEMES} value={theme} onChange={setTheme} />
      <Item icon={<Expand {...ICON} />} label="全屏" shortcut="F" onSelect={windowActions.toggleFullscreen} />

      <h5>文件</h5>
      <Item icon={<ImagePlus {...ICON} />} label="打开文件" shortcut="Ctrl O" onSelect={() => fileActions.openDialog()} />
      <Item icon={<FolderOpen {...ICON} />} label="打开文件夹" shortcut="Ctrl Shift O" onSelect={() => fileActions.openDialog(true)} />
      <Item icon={<FolderSearch {...ICON} />} label="在资源管理器中显示" shortcut="Ctrl E" onSelect={fileActions.reveal} />
      <Item icon={<Copy {...ICON} />} label="复制路径" shortcut="Ctrl Shift C" onSelect={fileActions.copyPath} />
      <Item icon={<Trash2 {...ICON} />} label="移至回收站" shortcut="Del" danger onSelect={fileActions.trash} />

      <footer>
        <span>OctLook{version ? ` ${version}` : ""}</span>
        <button disabled={checking} onClick={() => void useUpdate.getState().check(true)}>
          {checking ? "正在检查…" : "检查更新"}
        </button>
      </footer>
    </div>
  );
}
