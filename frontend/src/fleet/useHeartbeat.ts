import { useEffect, type RefObject } from "react";

/** One beat of the console's shared clock, in milliseconds. Four beats make one pulse or blink cycle. */
export const BEAT_MS = 450;

/**
 * Steps `data-beat` on `el` through 0..3 on a single timer while `enabled`, and removes it otherwise.
 * The pulse ring and the agent and plan-step blinks in fleet.css read it. Each CSS animation that repeats
 * forever steps at its own phase, so a page with many of them changes on almost every display refresh.
 * One shared beat changes them all at once, a few times a second. It is set on the element directly, so
 * a beat never re-renders React. It stays still under prefers-reduced-motion.
 */
export function useHeartbeat(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      delete el.dataset.beat;
    };
    const start = () => {
      stop();
      if (query?.matches) return;
      let beat = 0;
      el.dataset.beat = "0";
      timer = setInterval(() => {
        beat = (beat + 1) % 4;
        el.dataset.beat = String(beat);
      }, BEAT_MS);
    };
    start();
    query?.addEventListener?.("change", start);
    return () => {
      query?.removeEventListener?.("change", start);
      stop();
    };
  }, [ref, enabled]);
}
