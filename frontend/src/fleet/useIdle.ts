// True once `enabled` has been on for `ms` with no pointer movement, touch or key press. Used by wall
// mode to hide the cursor and its buttons. Movement over an element marked data-wall-control never
// counts as idle, so a control is never hidden from under the pointer.
import { useEffect, useState } from "react";

export const IDLE_MS = 4000;

export function useIdle(enabled: boolean, ms: number = IDLE_MS): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let overControl = false;
    const arm = () => {
      if (timer) clearTimeout(timer);
      setIdle(false);
      if (!overControl) timer = setTimeout(() => setIdle(true), ms);
    };
    const onPointer = (e: Event) => {
      overControl = e.target instanceof Element && e.target.closest("[data-wall-control]") !== null;
      arm();
    };
    const onOther = () => {
      overControl = false;
      arm();
    };
    arm();
    document.addEventListener("pointermove", onPointer);
    document.addEventListener("touchstart", onOther);
    document.addEventListener("keydown", onOther);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointermove", onPointer);
      document.removeEventListener("touchstart", onOther);
      document.removeEventListener("keydown", onOther);
    };
  }, [enabled, ms]);
  return enabled && idle;
}
