// Color theme and light/dark/system mode. The choice is kept in localStorage and applied as
// data-theme-name (palette), data-theme (resolved light or dark) and data-mode (the choice) on <html>,
// which themes.css and fleet.css read. index.html sets the same attributes before first paint.
import { useCallback, useEffect, useRef, useState } from "react";
import { readJson, writeJson } from "./storage";
import { effectiveTheme, parseChoice, resolveMode, type Mode, type ModeChoice, type ThemeChoice } from "./themes";

const KEY = "podium.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function osQuery(): MediaQueryList | null {
  try {
    return window.matchMedia(DARK_QUERY);
  } catch {
    return null;
  }
}

function apply(choice: ThemeChoice, resolved: Mode) {
  const d = document.documentElement.dataset;
  d.themeName = effectiveTheme(choice.theme, resolved);
  d.theme = resolved;
  d.mode = choice.mode;
}

export function useTheme(): {
  theme: string;
  mode: ModeChoice;
  resolved: Mode;
  setTheme: (theme: string) => void;
  setMode: (mode: ModeChoice) => void;
} {
  const [choice, setChoice] = useState<ThemeChoice>(() => parseChoice(readJson<unknown>(KEY, null)));
  const latest = useRef(choice);
  const [osDark, setOsDark] = useState(() => osQuery()?.matches ?? true);
  const resolved = resolveMode(choice.mode, osDark);

  useEffect(() => {
    const q = osQuery();
    if (!q) return;
    const on = () => setOsDark(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  useEffect(() => apply(choice, resolved), [choice, resolved]);

  const update = useCallback((patch: Partial<ThemeChoice>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setChoice(next);
    writeJson(KEY, next);
  }, []);
  const setTheme = useCallback((theme: string) => update({ theme }), [update]);
  const setMode = useCallback((mode: ModeChoice) => update({ mode }), [update]);
  return { theme: choice.theme, mode: choice.mode, resolved, setTheme, setMode };
}
