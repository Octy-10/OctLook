/** Platform differences the UI has to follow: modifier keys, shortcut glyphs, system names. */
export const isMac = navigator.userAgent.includes("Mac");

/** The primary shortcut modifier: ⌘ on macOS, Ctrl elsewhere. */
export const primaryKey = (e: KeyboardEvent | MouseEvent) => (isMac ? e.metaKey : e.ctrlKey);

/**
 * Shortcut text written the Windows way ("复制路径  Ctrl Shift C", "Del")
 * in the platform's own notation: macOS shows "⇧⌘C" and "⌫".
 */
export const keys = (text: string) =>
  isMac
    ? text
        .replace(/Ctrl Shift (\S+)/g, "⇧⌘$1")
        .replace(/Ctrl (\S+)/g, "⌘$1")
        .replace(/Shift (\S+)/g, "⇧$1")
        .replace(/\bDel\b/g, "⌫")
    : text;

export const REVEAL_LABEL = isMac ? "在访达中显示" : "在资源管理器中显示";
export const TRASH_LABEL = isMac ? "移到废纸篓" : "移至回收站";
