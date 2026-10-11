import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { keyWidth, LIMITS, type Panel, type Resizable } from "../useResizable";

/** A vertical separator between two columns: drag, arrow keys (Shift for 48 px), double-click or Home to reset. */
export function ResizeHandle(props: { panel: Panel; r: Resizable; container: () => HTMLElement | null; label: string }) {
  const { panel, r } = props;
  const dragging = useRef(false);
  const current = r.width(panel);
  const fromPointer = (clientX: number) => {
    const el = props.container();
    if (!el || !Number.isFinite(clientX)) return current;
    const box = el.getBoundingClientRect();
    return panel === "rail" ? clientX - box.left : box.right - clientX;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button) return;
    e.preventDefault();
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not all environments support capture
    }
    e.currentTarget.classList.add("drag");
    document.body.classList.add("podium-resizing");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    r.set(panel, fromPointer(e.clientX), false);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.classList.remove("drag");
    document.body.classList.remove("podium-resizing");
    r.set(panel, fromPointer(e.clientX), true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const w = keyWidth(panel, e.key, e.shiftKey, current);
    if (w === null) return;
    e.preventDefault();
    if (w === undefined) r.reset(panel);
    else r.set(panel, w, true);
  };
  return (
    <div
      className={`rz rz-${panel}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={current}
      aria-valuemin={LIMITS[panel][0]}
      aria-valuemax={LIMITS[panel][1]}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => r.reset(panel)}
      onKeyDown={onKeyDown}
    />
  );
}
