import type { DatabaseSync } from 'node:sqlite';

/** A feature the Admin can turn off for everyone on this server. A later flag adds one entry here. SPEC 8.1. */
export interface FeatureDef {
  id: string;
  name: string;
  description: string;
}

export const ACTIVITY_FEED = 'activity-feed';

export const FEATURES: readonly FeatureDef[] = [
  {
    id: ACTIVITY_FEED,
    name: 'Agent activity feed',
    description:
      "Shows an agent's recent tool calls and text in its panel while someone watches. Needs the reporter's activityFeed option on the machine as well. Nothing is kept after the panel closes.",
  },
];

export function isFeatureId(id: string): boolean {
  return FEATURES.some((f) => f.id === id);
}

const PREFIX = 'feature.';

/**
 * Server-wide feature flags (Admin > Settings > Feature flags): one on/off switch per feature, on by default. They live
 * in the settings table with the other Admin settings (`feature.<id>`, '0' when off), so they apply to every browser and
 * survive a restart. `onChange` lets the fleet act on a change and tell open browsers.
 */
export class FeatureFlags {
  constructor(
    private readonly db: DatabaseSync,
    private readonly onChange: (id: string, on: boolean) => void = () => {},
  ) {}

  private get(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value;
  }

  featureOn(id: string): boolean {
    return this.get(PREFIX + id) !== '0';
  }

  /** Returns false for an id that is not a known flag. */
  setFeature(id: string, on: boolean): boolean {
    if (!isFeatureId(id)) return false;
    const value = on ? '1' : '0';
    const was = this.get(PREFIX + id);
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(PREFIX + id, value);
    // An unset flag is on, so writing '1' over nothing is no change.
    if ((was ?? '1') !== value) this.onChange(id, on);
    return true;
  }

  /** Every flag by id, as `StateBody.features` sends it to the console. */
  view(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const f of FEATURES) out[f.id] = this.featureOn(f.id);
    return out;
  }
}
