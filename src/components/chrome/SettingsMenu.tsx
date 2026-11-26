import { useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  CircleHelp,
  Copy,
  Expand,
  FolderOpen,
  FolderSearch,
  ImagePlus,
  Info,
  Maximize,
  Scan,
  Trash2,
} from "lucide-react";

import { useAsync } from "../../hooks/useAsync";
import { useResidentSettings } from "../../hooks/useResidentSettings";
import { fileActions, viewActions, windowActions } from "../../lib/actions";
import { isMac, REVEAL_LABEL, TRASH_LABEL } from "../../lib/platform";
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

function Switch(props: { label: string; help?: string; checked: boolean; disabled?: boolean; onChange(): void }) {
  return (
    <div className={styles.field} data-disabled={props.disabled || undefined}>
      <span className={styles.label}>
        {props.label}
        {props.help && (
          <span className={styles.help} data-tip={props.help} data-tip-wrap data-tip-align="start">
            <CircleHelp size={13} strokeWidth={1.75} />
          </span>
        )}
      </span>
      <button className={styles.switch} role="switch" aria-checked={props.checked} aria-label={props.label} disabled={props.disabled} onClick={props.onChange} />
    </div>
  );
}

/** Windows only: Space preview from Explorer keeps OctLook running in the tray. */
function SystemSection() {
  const { settings, toggleSpacePreview, toggleAutostart } = useResidentSettings();
  if (!settings) return null;
  return (
    <>
      <h5>系统</h5>
      <Switch
        label="空格预览"
        help="在文件夹或桌面选中文件，按空格键就能快速预览，再按一次关闭"
        checked={settings.spacePreview}
        onChange={toggleSpacePreview}
      />
      <Switch label="开机自启" checked={settings.autostart} disabled={!settings.spacePreview} onChange={toggleAutostart} />
    </>
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
      <Item icon={<Info {...ICON} />} label="文件信息" shortcut="I" checked={panel === "info"} onSelect={() => togglePanel("info")} />

      <h5>显示</h5>
      <Item icon={<Scan {...ICON} />} label="适应窗口" shortcut="0" onSelect={viewActions.fit} />
      <Item icon={<Maximize {...ICON} />} label="实际大小" shortcut="1" onSelect={viewActions.actualSize} />
      <Segmented label="画布背景" options={BACKDROPS} value={backdrop} onChange={setBackdrop} />
      <Segmented label="界面外观" options={THEMES} value={theme} onChange={setTheme} />
      <Item icon={<Expand {...ICON} />} label="全屏" shortcut="F" onSelect={windowActions.toggleFullscreen} />

      <h5>文件</h5>
      <Item icon={<ImagePlus {...ICON} />} label="打开文件" shortcut="Ctrl O" onSelect={() => fileActions.openDialog()} />
      <Item icon={<FolderOpen {...ICON} />} label="打开文件夹" shortcut="Ctrl Shift O" onSelect={() => fileActions.openDialog(true)} />
      <Item icon={<FolderSearch {...ICON} />} label={REVEAL_LABEL} shortcut="Ctrl E" onSelect={fileActions.reveal} />
      <Item icon={<Copy {...ICON} />} label="复制路径" shortcut="Ctrl Shift C" onSelect={fileActions.copyPath} />
      <Item icon={<Trash2 {...ICON} />} label={TRASH_LABEL} shortcut="Del" danger onSelect={fileActions.trash} />

      {!isMac && <SystemSection />}

      <footer>
        <span>OctLook{version ? ` ${version}` : ""}</span>
        <button disabled={checking} onClick={() => void useUpdate.getState().check(true)}>
          {checking ? "正在检查…" : "检查更新"}
        </button>
      </footer>
    </div>
  );
}
