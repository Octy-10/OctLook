import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppWindow, ChevronRight } from "lucide-react";

import { useOpenWithApps } from "../../hooks/useDefaultApp";
import { api, errorMessage } from "../../lib/ipc";
import { toast } from "../../store/toast";
import { MENU_ICON as ICON, MenuItem as Item } from "./Menu";
import styles from "./Menu.module.css";

/** Leaving the row for its submenu crosses the menu padding: wait a moment before closing. */
const CLOSE_DELAY = 200;
/** Gap kept between the list and the window edges. */
const EDGE = 8;
/** The list's offset from its row: the menu padding, so the rows line up. */
const GAP = 6;

const report = (e: unknown) => toast(errorMessage(e), "error");

/**
 * "Open with" (Windows) as a menu row: hovering it lists the apps the system
 * recommends for `path`, as Explorer does, then "choose another app" for the
 * system dialog with every app. `onOpened` runs once an app took the file.
 */
export function OpenWithItem({ path, onOpened }: { path: string; onOpened?: () => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={styles.sub} onPointerEnter={show} onPointerLeave={hide}>
      <button className={styles.item} role="menuitem" aria-haspopup="menu" aria-expanded={open} data-active={open || undefined} onClick={show}>
        <AppWindow {...ICON} />
        <span>打开方式</span>
        <ChevronRight {...ICON} className={styles.chevron} />
      </button>
      {open && <AppList path={path} onOpened={onOpened} />}
    </div>
  );
}

function AppList({ path, onOpened }: { path: string; onOpened?: () => void }) {
  const apps = useOpenWithApps(path);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();

  // Beside the row: to its right, else to its left, else (a window too narrow
  // for either, like a small preview) over the menu; always inside the window.
  // Measured again once the apps arrive, as the list then grows.
  useLayoutEffect(() => {
    const list = ref.current!;
    const row = list.parentElement!.getBoundingClientRect();
    const { width, height } = list.getBoundingClientRect();
    const clamp = (v: number, size: number, room: number) => Math.max(EDGE, Math.min(v, room - EDGE - size));
    const right = row.right + GAP;
    const left = row.left - GAP - width;
    const x = right + width <= innerWidth - EDGE ? right : left >= EDGE ? left : clamp(right, width, innerWidth);
    const y = clamp(row.top - GAP, height, innerHeight);
    setPlace({ left: x - row.left, top: y - row.top });
  }, [apps]);

  return (
    <div ref={ref} className={`${styles.menu} ${styles.submenu}`} style={place} role="menu">
      {apps === undefined && <Item icon={<i className={styles.appIcon} />} label="正在读取…" disabled onSelect={() => {}} />}
      {apps?.map((app) => (
        <Item
          key={app.id}
          icon={app.icon ? <img className={styles.appIcon} src={app.icon} alt="" draggable={false} /> : <AppWindow {...ICON} />}
          label={app.name}
          onSelect={() => api.openWithDefault(path, app.id).then(onOpened, report)}
        />
      ))}
      {!!apps?.length && <div className={styles.separator} />}
      <Item icon={<i className={styles.appIcon} />} label="选择其他应用" onSelect={() => api.openWithDialog(path).then((picked) => picked && onOpened?.(), report)} />
    </div>
  );
}
