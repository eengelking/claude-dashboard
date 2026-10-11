// Resizable side panels (SPEC 8.1): drag, arrow keys (16 px, Shift 48 px), double-click or Home to
// reset, widths remembered. The main column never gets narrower than MIN_MAIN.
import { useCallback, useEffect, useState } from "react";
import { readJson, writeJson } from "./storage";

export type Panel = "rail" | "side";
export const LIMITS: Record<Panel, [number, number]> = { rail: [180, 440], side: [260, 700] };
export const DEFAULTS: Record<Panel, number> = { rail: 252, side: 340 };
export const MIN_MAIN = 420;
export const STEP = 16;
export const BIG_STEP = 48;
const KEY = "podium.panels";

export type Widths = Partial<Record<Panel, number>>;

/** Clamps a width to its panel's limits and to what leaves the main column MIN_MAIN wide. */
export function clampWidth(panel: Panel, w: number, containerWidth: number, otherWidth: number): number {
  const [min, max] = LIMITS[panel];
  if (!Number.isFinite(w)) w = DEFAULTS[panel];
  const room = containerWidth > 0 ? containerWidth - otherWidth - MIN_MAIN : max;
  return Math.round(Math.max(min, Math.min(max, room, w)));
}

/** The width a key press asks for, or null for keys that do not resize. `Home` resets (returns undefined). */
export function keyWidth(panel: Panel, key: string, shift: boolean, current: number): number | null | undefined {
  if (key === "Home" || key === "Escape") return undefined;
  const dir = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (!dir) return null;
  // The rail grows to the right; the side panel grows to the left.
  return current + (panel === "rail" ? dir : -dir) * (shift ? BIG_STEP : STEP);
}

export interface Resizable {
  widths: Widths;
  /** The width shown now: the chosen one or the default. */
  width: (p: Panel) => number;
  set: (p: Panel, w: number, save: boolean) => void;
  reset: (p: Panel) => void;
}

export function useResizable(container: () => HTMLElement | null): Resizable {
  const [widths, setWidths] = useState<Widths>(() => {
    const v = readJson<Widths>(KEY, {});
    const out: Widths = {};
    for (const p of ["rail", "side"] as Panel[]) {
      const n = v && typeof v[p] === "number" ? v[p] : undefined;
      if (n !== undefined) out[p] = Math.max(LIMITS[p][0], Math.min(LIMITS[p][1], n));
    }
    return out;
  });

  const width = useCallback((p: Panel) => widths[p] ?? DEFAULTS[p], [widths]);

  const set = useCallback(
    (p: Panel, w: number, save: boolean) => {
      setWidths((cur) => {
        const other: Panel = p === "rail" ? "side" : "rail";
        const el = container();
        const next = { ...cur, [p]: clampWidth(p, w, el?.clientWidth ?? 0, cur[other] ?? DEFAULTS[other]) };
        if (save) writeJson(KEY, next);
        return next;
      });
    },
    [container],
  );

  const reset = useCallback((p: Panel) => {
    setWidths((cur) => {
      const { [p]: _gone, ...rest } = cur;
      writeJson(KEY, rest);
      return rest;
    });
  }, []);

  // Keep the stored widths inside the window as it shrinks.
  useEffect(() => {
    const onResize = () => {
      setWidths((cur) => {
        const el = container();
        if (!el) return cur;
        const next: Widths = { ...cur };
        for (const p of ["rail", "side"] as Panel[]) {
          const v = cur[p];
          if (v !== undefined) next[p] = clampWidth(p, v, el.clientWidth, cur[p === "rail" ? "side" : "rail"] ?? DEFAULTS[p === "rail" ? "side" : "rail"]);
        }
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [container]);

  return { widths, width, set, reset };
}
