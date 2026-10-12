import type { ModeChoice } from "../themes";
import { NOTICES_URL, THEMES } from "../themes";
import type { useTheme } from "../useTheme";

const MODES: { id: ModeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

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
      <div className="seg" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={theme.mode === m.id} onClick={() => theme.setMode(m.id)}>
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
