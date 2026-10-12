// The shipped color themes and the pure rules for choosing among them. The palettes themselves live in
// themes.css, keyed by [data-theme-name] and [data-theme] on <html>. The inline script in index.html
// repeats parseChoice and resolveMode in miniature so the page is painted before React loads.
export type Mode = "light" | "dark";
export type ModeChoice = Mode | "system";
export type ThemeChoice = { theme: string; mode: ModeChoice };
export type ThemeInfo = { id: string; label: string; credit: string; modes: readonly Mode[] };

export const NOTICES_URL = "https://github.com/eengelking/podium/blob/main/THIRD_PARTY_NOTICES.md";

export const THEMES: readonly ThemeInfo[] = [
  { id: "podium", label: "Podium", credit: "Podium's own palette", modes: ["light", "dark"] },
  { id: "solarized", label: "Solarized", credit: "Ethan Schoonover, MIT license", modes: ["light", "dark"] },
  { id: "nord", label: "Nord", credit: "Arctic Ice Studio, MIT license", modes: ["light", "dark"] },
  { id: "gruvbox", label: "Gruvbox", credit: "Pavel Pertsev, MIT license", modes: ["light", "dark"] },
  { id: "catppuccin", label: "Catppuccin (Latte, Mocha)", credit: "Catppuccin Org, MIT license", modes: ["light", "dark"] },
  { id: "github", label: "GitHub", credit: "GitHub Primer, MIT license", modes: ["light", "dark"] },
];

export const DEFAULT_THEME = "podium";
export const DEFAULT_CHOICE: ThemeChoice = { theme: DEFAULT_THEME, mode: "system" };

const isMode = (v: unknown): v is ModeChoice => v === "light" || v === "dark" || v === "system";

// Reads a stored value. The old toggle stored the bare string "light" or "dark"; that becomes Podium in
// that mode. Anything unrecognised falls back to the default rather than throwing.
export function parseChoice(raw: unknown, themes: readonly ThemeInfo[] = THEMES): ThemeChoice {
  if (raw === "light" || raw === "dark") return { theme: DEFAULT_THEME, mode: raw };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const { theme, mode } = raw as { theme?: unknown; mode?: unknown };
    return {
      theme: themes.some((t) => t.id === theme) ? (theme as string) : DEFAULT_THEME,
      mode: isMode(mode) ? mode : "system",
    };
  }
  return DEFAULT_CHOICE;
}

export function resolveMode(mode: ModeChoice, osDark: boolean): Mode {
  return mode === "system" ? (osDark ? "dark" : "light") : mode;
}

// The palette actually applied. A theme with no palette for the mode uses Podium's for that mode.
export function effectiveTheme(id: string, mode: Mode, themes: readonly ThemeInfo[] = THEMES): string {
  const t = themes.find((x) => x.id === id);
  return t && t.modes.includes(mode) ? t.id : DEFAULT_THEME;
}
