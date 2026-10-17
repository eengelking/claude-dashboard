import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const GUTTER = 8;

/**
 * A note on a word or badge that opens on hover and on keyboard focus, closes on blur, on mouse leave while the trigger
 * is not focused, and on Escape, and wraps in a narrow panel. The text is always in the page as a `role="tooltip"` line
 * the trigger names with `aria-describedby`, so a screen reader reads it whether or not the box is open. Replaces `title`
 * plus `tabIndex`, which a browser does not show on focus (issue #275). The box is `position: fixed` and placed from the
 * trigger's rectangle, so a table's scroll container cannot clip it.
 */
export function Tip({ text, className, style, children }: { text: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = (hover || focus) && !dismissed;

  // Place the box under the trigger (above it when there is no room below), kept inside the viewport.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !box.current) {
      setPos(null);
      return;
    }
    const t = trigger.current.getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    const below = t.bottom + 6;
    const top = below + b.height > window.innerHeight - GUTTER && t.top - 6 - b.height >= GUTTER ? t.top - 6 - b.height : below;
    const left = Math.max(GUTTER, Math.min(t.left, window.innerWidth - b.width - GUTTER));
    setPos({ top, left });
  }, [open, text]);

  // Escape closes a note opened by hover alone, which has no focus to receive the key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      ref={trigger}
      className={className ? `tip ${className}` : "tip"}
      style={style}
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={() => {
        setHover(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHover(false)}
      onFocus={() => {
        setFocus(true);
        setDismissed(false);
      }}
      onBlur={() => setFocus(false)}
    >
      {children}
      <span ref={box} id={id} role="tooltip" className="tipbox" hidden={!open} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
        {text}
      </span>
    </span>
  );
}
