import type { ReactNode } from "react";

/** One informational wall notice. A later notice adds an entry where the stack is built, and gets its X for free. */
export interface NoticeItem {
  id: string;
  name: string;
  body: ReactNode;
}

/**
 * Informational notices sit together at the bottom of the wall, one per row, each with an X. Closing one turns it off
 * for everyone and the user is told where to switch it back on (Admin > Settings). Errors and connection problems are
 * not notices and never come through here. SPEC 8.1.
 */
export function NoticeStack({ items, onClose }: { items: NoticeItem[]; onClose: (item: NoticeItem) => void }) {
  if (!items.length) return null;
  return (
    <div className="notices">
      {items.map((n) => (
        <div className="fold" key={n.id}>
          <div className="txt">{n.body}</div>
          <button type="button" className="x" aria-label={`Close notice: ${n.name}`} onClick={() => onClose(n)}>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/** The confirmation after a notice is closed: which notice, and the link to Admin > Settings. It has its own X. */
export function NoticeClosed({ name, onDismiss }: { name: string; onDismiss: () => void }) {
  return (
    <div className="toast" role="status">
      <div className="t">
        <b>Notice turned off</b>
        <span>“{name}” will not show again. You can turn it back on or off in Admin &gt; Settings.</span>
        <br />
        <a className="go" href="#/admin/settings">
          Open Admin &gt; Settings
        </a>
      </div>
      <button type="button" className="x" aria-label="Close this message" onClick={onDismiss}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}
