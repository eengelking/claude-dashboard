// The viewer's people-view choices, remembered in this browser (issue #34). "Me" lives here because only
// the browser can say who is looking: the server serves the same console to everyone.
import { useCallback, useState } from "react";
import { readJson, writeJson } from "./storage";
import { GROUP_BYS, UNIT_ORDERS, type GroupBy, type UnitOrder } from "./people";

export const PREFS_KEY = "podium.people";
export const ME_KEY = "podium.me";
const ME_MAX = 80;

export interface PeoplePrefs {
  groupBy: GroupBy;
  order: UnitOrder;
  spendView: "chart" | "table";
  /** Band keys collapsed to their header, per Group by (`people:p:Ed E.`). */
  collapsed: string[];
}

export const DEFAULT_PREFS: PeoplePrefs = { groupBy: "people", order: "attention", spendView: "chart", collapsed: [] };

/** Stored prefs, with anything unreadable or unknown replaced by its default. */
export function parsePrefs(v: unknown): PeoplePrefs {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const pick = <T extends string>(x: unknown, allowed: Record<T, string>, d: T): T => (typeof x === "string" && Object.prototype.hasOwnProperty.call(allowed, x) ? (x as T) : d);
  return {
    groupBy: pick(o.groupBy, GROUP_BYS, DEFAULT_PREFS.groupBy),
    order: pick(o.order, UNIT_ORDERS, DEFAULT_PREFS.order),
    spendView: o.spendView === "table" ? "table" : "chart",
    collapsed: Array.isArray(o.collapsed) ? o.collapsed.filter((k): k is string => typeof k === "string").slice(0, 200) : [],
  };
}

export function parseMe(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, ME_MAX) : null;
}

export function usePeoplePrefs(): {
  prefs: PeoplePrefs;
  setPrefs: (p: Partial<PeoplePrefs>) => void;
  toggleBand: (key: string) => void;
  me: string | null;
  setMe: (name: string | null) => void;
} {
  const [prefs, setState] = useState<PeoplePrefs>(() => parsePrefs(readJson<unknown>(PREFS_KEY, null)));
  const [me, setMeState] = useState<string | null>(() => parseMe(readJson<unknown>(ME_KEY, null)));
  const setPrefs = useCallback((p: Partial<PeoplePrefs>) => {
    setState((cur) => {
      const next = { ...cur, ...p };
      writeJson(PREFS_KEY, next);
      return next;
    });
  }, []);
  const toggleBand = useCallback((key: string) => {
    setState((cur) => {
      const next = { ...cur, collapsed: cur.collapsed.includes(key) ? cur.collapsed.filter((k) => k !== key) : [...cur.collapsed, key] };
      writeJson(PREFS_KEY, next);
      return next;
    });
  }, []);
  const setMe = useCallback((name: string | null) => {
    const v = parseMe(name);
    setMeState(v);
    writeJson(ME_KEY, v ?? undefined);
  }, []);
  return { prefs, setPrefs, toggleBand, me, setMe };
}
