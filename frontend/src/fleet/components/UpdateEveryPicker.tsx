import { UPDATE_CHOICES } from "../updateInterval";

// How often the fleet page redraws (#138), shown in the banner to the left of the Theme controls. It reads like the
// activity feed's "Refresh every" so the two controls look related.
export function UpdateEveryPicker({ every, onChange }: { every: number; onChange: (seconds: number) => void }) {
  return (
    <label className="field">
      <span>Refresh every</span>
      <select className="sel" value={every} onChange={(e) => onChange(Number(e.target.value))} title="How often the console redraws from new data">
        {UPDATE_CHOICES.map((n) => (
          <option key={n} value={n}>
            {n}s
          </option>
        ))}
      </select>
    </label>
  );
}
