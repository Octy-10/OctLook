import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ClipboardCopy,
  Copy,
  FolderSearch,
  Info,
  Save,
  ScanText,
  Trash2,
} from "lucide-react";

import { editActions, fileActions } from "../../lib/actions";
import { isMac, REVEAL_LABEL, TRASH_LABEL } from "../../lib/platform";
import { useCurrentEntry } from "../../store/library";
import { useViewState } from "../../store/view";
import { MENU_ICON as ICON, MenuItem as Item, useMenuDismiss } from "./Menu";
import { OpenWithItem } from "./OpenWithMenu";
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

interface MenuProps {
  at: Point;
  onClose(): void;
}

/** A right-click menu at `at`, closed by a pick, Escape or a press elsewhere. */
function ContextMenuFrame({ at, onClose, children }: MenuProps & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Point>(at);
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
      {children}
    </div>
  );
}

/** Quick commands for the image under the pointer. */
export function ContextMenu(props: MenuProps) {
  const panel = useViewState((s) => s.panel);
  const path = useCurrentEntry()?.path;
  return (
    <ContextMenuFrame {...props}>
      <Item icon={<ClipboardCopy {...ICON} />} label="复制图像" shortcut="Ctrl C" onSelect={editActions.copyImage} />
      <Item icon={<Copy {...ICON} />} label="复制文件路径" shortcut="Ctrl Shift C" onSelect={fileActions.copyPath} />
      <Item icon={<FolderSearch {...ICON} />} label={REVEAL_LABEL} shortcut="Ctrl E" onSelect={fileActions.reveal} />
      {!isMac && path && <OpenWithItem path={path} />}
      <div className={styles.separator} />
      <Item icon={<ScanText {...ICON} />} label="提取文字" shortcut="O" onSelect={editActions.extractText} />
      <Item icon={<Info {...ICON} />} label="文件信息" shortcut="I" checked={panel === "info"} onSelect={() => useViewState.getState().togglePanel("info")} />
      <Item icon={<Save {...ICON} />} label="另存为" shortcut="Ctrl S" onSelect={editActions.export} />
      <div className={styles.separator} />
      <Item icon={<Trash2 {...ICON} />} label={TRASH_LABEL} shortcut="Del" danger onSelect={fileActions.trash} />
    </ContextMenuFrame>
  );
}

/** The Space preview's menu: the file itself, not the view (Windows only). */
export function PreviewContextMenu({ path, onOpened, ...props }: MenuProps & { path: string; onOpened(): void }) {
  return (
    <ContextMenuFrame {...props}>
      <Item icon={<Copy {...ICON} />} label="复制文件路径" onSelect={fileActions.copyPath} />
      <Item icon={<FolderSearch {...ICON} />} label={REVEAL_LABEL} onSelect={fileActions.reveal} />
      <OpenWithItem path={path} onOpened={onOpened} />
    </ContextMenuFrame>
  );
}
