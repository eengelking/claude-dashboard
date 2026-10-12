// One document-level key listener for the shell shortcuts. It stays out of the way of typing (fields,
// editable text), of the browser's own shortcuts (ctrl, meta, alt), and of the resize separators, which
// use the arrow keys, Home and Escape themselves.
import { useEffect, useRef } from "react";

function ignored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [role='separator'], [contenteditable]:not([contenteditable='false'])") !== null;
}

export function useHotkeys(onKey: (e: KeyboardEvent) => void): void {
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || ignored(e.target)) return;
      handler.current(e);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
}
