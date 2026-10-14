import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The console's modal (issue #97, mockup/podium-prompt-modal.html), shared by the Report modal and the activity
// feed's (#118). Portaled to <body> inside its own .podium wrapper for the theme tokens; the app behind it blurs
// (body.modal-open). It closes with the X, Esc or a mousedown on the dimmed area; focus moves to the X, Tab stays
// inside, and the caller returns focus to whatever opened it. While it is open the page behind gets no keys, so
// Esc does not leave wall mode and the shell shortcuts are off.

const FOCUSABLE = "button:not([disabled]), a[href], select:not([disabled]), [tabindex='0']";

export function Modal(props: {
  titleId: string;
  title: ReactNode;
  sub?: ReactNode;
  /** Controls in the header, before the X. */
  actions?: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    document.body.classList.add("modal-open");
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onClose.current();
      } else if (e.key === "Tab") {
        const f = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        const first = f[0];
        const last = f[f.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("modal-open");
    };
  }, []);

  return createPortal(
    <div className="podium podium-modal">
      <div
        className="scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div className={`modal${props.className ? ` ${props.className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={props.titleId} ref={dialog}>
          <div className="mh">
            <div className="ttl">
              <h2 id={props.titleId}>{props.title}</h2>
              {props.sub && <div className="sub2">{props.sub}</div>}
            </div>
            {props.actions}
            <button type="button" className="x" ref={closeBtn} onClick={props.onClose} aria-label="Close (Esc)">
              ✕
            </button>
          </div>
          {props.children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
