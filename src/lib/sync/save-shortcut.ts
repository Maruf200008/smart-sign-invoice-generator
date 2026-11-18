/** Ctrl+S on Windows/Linux, Cmd+S on macOS (Shift allowed, so "Save as" is caught too; Alt is left alone). */
export function isSaveShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  // `code` keeps the shortcut working on non-Latin keyboard layouts (e.g. Bangla), where `key` isn't "s".
  return event.key?.toLowerCase() === "s" || event.code === "KeyS";
}

export function saveShortcutLabel() {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad/i.test(platform) ? "⌘S" : "Ctrl+S";
}

type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "preventDefault" | "stopPropagation">;

/**
 * Keydown handler for the save shortcut: always blocks the browser's "Save page" dialog, and calls `onSave`
 * once per key press (auto-repeat while the keys are held down is swallowed).
 */
export function createSaveShortcutHandler(onSave: () => void) {
  return (event: ShortcutEvent) => {
    if (!isSaveShortcut(event)) return;

    event.preventDefault();
    event.stopPropagation();

    if (!event.repeat) onSave();
  };
}
