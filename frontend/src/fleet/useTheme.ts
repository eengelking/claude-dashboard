// Light and dark themes. Default follows the OS; an explicit choice is kept in localStorage and set
// as data-theme on <html>, which fleet.css reads.
import { useCallback, useEffect, useState } from "react";
import { readJson, writeJson } from "./storage";

export type Theme = "light" | "dark";
const KEY = "podium.theme";

function osTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function apply(theme: Theme | null) {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function useTheme(): { theme: Theme; choice: Theme | null; toggle: () => void } {
  const [choice, setChoice] = useState<Theme | null>(() => {
    const v = readJson<unknown>(KEY, null);
    return v === "light" || v === "dark" ? v : null;
  });
  useEffect(() => apply(choice), [choice]);
  const theme = choice ?? osTheme();
  const toggle = useCallback(() => {
    setChoice((c) => {
      const next: Theme = (c ?? osTheme()) === "dark" ? "light" : "dark";
      writeJson(KEY, next);
      return next;
    });
  }, []);
  return { theme, choice, toggle };
}
