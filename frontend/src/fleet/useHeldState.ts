import { useEffect, useRef, useState } from "react";

/**
 * Returns `value` as it stood at the last tick of `everyMs`, so the page below redraws once per interval instead of
 * on every change. A change for which `urgent(held, next)` is true shows at once. Changing `everyMs` shows the newest
 * value straight away and restarts the clock.
 */
export function useHeldState<T>(value: T, everyMs: number, urgent: (held: T, next: T) => boolean): T {
  const [held, setHeld] = useState(value);
  const latest = useRef(value);
  latest.current = value;

  const shown = held !== value && urgent(held, value) ? value : held;

  useEffect(() => {
    if (shown !== held) setHeld(shown);
  }, [shown, held]);

  useEffect(() => {
    setHeld(latest.current);
    const t = setInterval(() => setHeld(latest.current), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);

  return shown;
}
