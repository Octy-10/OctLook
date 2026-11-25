import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ClipboardCopy,
  Copy,
  FlipHorizontal2,
  FolderSearch,
  Info,
  Maximize,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  ScanText,
  Trash2,
} from "lucide-react";

import { editActions, fileActions, viewActions } from "../../lib/actions";
import { useViewState } from "../../store/view";
import { MENU_ICON as ICON, MenuItem as Item, useMenuDismiss } from "./Menu";
import styles from "./Menu.module.css";

type Point = [x: number, y: number];
/** Gap kept between the menu and the window edges. */
const EDGE = 8;

/**
 * Replaces the WebView's own context menu (reload, inspect…) everywhere.
 * Text fields keep the native cut / copy / paste menu; a right-click on an
 * element marked `data-context-menu` opens the image menu at the pointer.
 */
export function useContextMenu() {
  const [at, setAt] = useState<Point | null>(null);
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input:not([type=range]), textarea, [contenteditable]")) return;
      e.preventDefault();
      if (target.closest("[data-context-menu]")) setAt([e.clientX, e.clientY]);
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);
  return { at, close: useCallback(() => setAt(null), []) };
}

/** Quick commands for the image under the pointer. */
export function ContextMenu({ at, onClose }: { at: Point; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Point>(at);
  const panel = useViewState((s) => s.panel);
  useMenuDismiss(() => ref.current, onClose);

  // Opens down-right of the pointer, flipping to the other side where it would leave the window.
  useLayoutEffect(() => {
    const { width, height } = ref.current!.getBoundingClientRect();
    const [x, y] = at;
    setPosition([
      x + width + EDGE > innerWidth ? Math.max(EDGE, x - width) : x,
      y + height + EDGE > innerHeight ? Math.max(EDGE, y - height) : y,
    ]);
  }, [at]);

  return (
    <div
      ref={ref}
      className={`${styles.menu} ${styles.context}`}
      style={{ left: position[0], top: position[1] }}
      role="menu"
      onClick={(e) => (e.target as Element).closest("[data-dismiss]") && onClose()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Item icon={<ClipboardCopy {...ICON} />} label="复制图像" shortcut="Ctrl C" onSelect={editActions.copyImage} />
      <Item icon={<Copy {...ICON} />} label="复制文件路径" shortcut="Ctrl Shift C" onSelect={fileActions.copyPath} />
      <Item icon={<FolderSearch {...ICON} />} label="在资源管理器中显示" shortcut="Ctrl E" onSelect={fileActions.reveal} />
      <div className={styles.separator} />
      <Item icon={<RotateCw {...ICON} />} label="向右旋转" shortcut="R" keepOpen onSelect={() => viewActions.rotate(1)} />
      <Item icon={<RotateCcw {...ICON} />} label="向左旋转" shortcut="Shift R" keepOpen onSelect={() => viewActions.rotate(-1)} />
      <Item icon={<FlipHorizontal2 {...ICON} />} label="水平翻转" shortcut="H" keepOpen onSelect={viewActions.flipX} />
      <Item icon={<Scan {...ICON} />} label="适应窗口" shortcut="0" onSelect={viewActions.fit} />
      <Item icon={<Maximize {...ICON} />} label="实际大小" shortcut="1" onSelect={viewActions.actualSize} />
      <div className={styles.separator} />
      <Item icon={<ScanText {...ICON} />} label="提取文字" shortcut="O" onSelect={editActions.extractText} />
      <Item icon={<Info {...ICON} />} label="文件信息" shortcut="I" checked={panel === "info"} onSelect={() => useViewState.getState().togglePanel("info")} />
      <Item icon={<Save {...ICON} />} label="导出" shortcut="Ctrl S" onSelect={editActions.export} />
      <div className={styles.separator} />
      <Item icon={<Trash2 {...ICON} />} label="移至回收站" shortcut="Del" danger onSelect={fileActions.trash} />
    </div>
  );
}
