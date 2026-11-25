import { useEffect, useRef, type ReactNode } from "react";

import styles from "./Menu.module.css";

export const MENU_ICON = { size: 15, strokeWidth: 1.75 };

interface ItemProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Toggles stay open so their new state is visible; commands close the menu. */
  keepOpen?: boolean;
  onSelect(): unknown;
}

export function MenuItem({ icon, label, shortcut, checked, danger, disabled, keepOpen, onSelect }: ItemProps) {
  return (
    <button
      className={styles.item}
      role="menuitem"
      disabled={disabled}
      data-checked={checked || undefined}
      data-danger={danger || undefined}
      data-dismiss={!keepOpen || undefined}
      onClick={() => void onSelect()}
    >
      {icon}
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

/**
 * Closes a menu on Escape, on a press outside `inside` (the menu, or the
 * menu and its toggle), and when the window loses focus or resizes.
 */
export function useMenuDismiss(inside: () => Node | null | undefined, onClose: () => void) {
  const latest = useRef(inside);
  latest.current = inside;
  useEffect(() => {
    const dismiss = (e: Event) => {
      if (e.type === "blur" && e.target !== window) return; // an element losing focus, not the window
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.stopPropagation(); // Escape closes the menu only, not fullscreen as well
      } else if (e.type === "pointerdown" && latest.current()?.contains(e.target as Node)) {
        return;
      }
      onClose();
    };
    // Capture phase: the HUD and panels stop pointer events from bubbling.
    const events = ["pointerdown", "keydown", "blur", "resize"] as const;
    events.forEach((type) => window.addEventListener(type, dismiss, true));
    return () => events.forEach((type) => window.removeEventListener(type, dismiss, true));
  }, [onClose]);
}
