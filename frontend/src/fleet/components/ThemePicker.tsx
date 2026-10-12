import type { KeyboardEvent } from "react";
import type { ModeChoice } from "../themes";
import { NOTICES_URL, THEMES } from "../themes";
import type { useTheme } from "../useTheme";

const MODES: { id: ModeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

// Arrow keys move through the radios and select as they go, as a native radio group does. Only the
// checked one is in the tab order.
function onRadioKey(e: KeyboardEvent<HTMLDivElement>, mode: ModeChoice, set: (m: ModeChoice) => void) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = MODES[(MODES.findIndex((m) => m.id === mode) + step + MODES.length) % MODES.length].id;
  set(next);
  const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
  buttons[MODES.findIndex((m) => m.id === next)]?.focus();
}

// A theme dropdown plus a light/dark/system radio group. The palettes are other people's work, so the
// credits link sits next to the control.
export function ThemePicker({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const current = THEMES.find((t) => t.id === theme.theme);
  return (
    <div className="themepick">
      <label className="field">
        <span>Theme</span>
        <select className="sel" value={theme.theme} onChange={(e) => theme.setTheme(e.target.value)} title={current?.credit}>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="seg" role="radiogroup" aria-label="Mode" onKeyDown={(e) => onRadioKey(e, theme.mode, theme.setMode)}>
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={theme.mode === m.id} tabIndex={theme.mode === m.id ? 0 : -1} onClick={() => theme.setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <a className="credits" href={NOTICES_URL} target="_blank" rel="noreferrer">
        Theme credits
      </a>
    </div>
  );
}
