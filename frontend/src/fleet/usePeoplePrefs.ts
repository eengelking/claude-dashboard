// The viewer's people-view choices, remembered in this browser (issue #34). Who "me" is comes from the browser's
// sign-in (useRespond), not from here: #245 retired the "You are" picker and its stored name.
import { useCallback, useState } from "react";
import { readJson, writeJson } from "./storage";
import { GROUP_BYS, UNIT_ORDERS, type GroupBy, type UnitOrder } from "./people";

export const PREFS_KEY = "podium.people";

export interface PeoplePrefs {
  groupBy: GroupBy;
  order: UnitOrder;
  /** Band keys collapsed to their header, per Group by (`people:p:Ed E.`). */
  collapsed: string[];
}

export const DEFAULT_PREFS: PeoplePrefs = { groupBy: "people", order: "attention", collapsed: [] };

/** Stored prefs, with anything unreadable or unknown replaced by its default. */
export function parsePrefs(v: unknown): PeoplePrefs {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const pick = <T extends string>(x: unknown, allowed: Record<T, string>, d: T): T => (typeof x === "string" && Object.prototype.hasOwnProperty.call(allowed, x) ? (x as T) : d);
  return {
    groupBy: pick(o.groupBy, GROUP_BYS, DEFAULT_PREFS.groupBy),
    order: pick(o.order, UNIT_ORDERS, DEFAULT_PREFS.order),
    collapsed: Array.isArray(o.collapsed) ? o.collapsed.filter((k): k is string => typeof k === "string").slice(0, 200) : [],
  };
}

export function usePeoplePrefs(): {
  prefs: PeoplePrefs;
  setPrefs: (p: Partial<PeoplePrefs>) => void;
  toggleBand: (key: string) => void;
} {
  const [prefs, setState] = useState<PeoplePrefs>(() => parsePrefs(readJson<unknown>(PREFS_KEY, null)));
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
  return { prefs, setPrefs, toggleBand };
}
