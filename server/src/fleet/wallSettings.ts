import type { DatabaseSync } from 'node:sqlite';
import type { WallSettingsView } from './protocol.js';

/** An informational notice the wall can show at the bottom. A later notice adds one entry here. SPEC 8.1. */
export interface NoticeDef {
  id: string;
  name: string;
  description: string;
}

export const NOTICES: readonly NoticeDef[] = [
  {
    id: 'background-sessions',
    name: 'Background sessions',
    description: 'Says how many sessions nobody is attached to are set aside, with a link to show them.',
  },
];

export function isNoticeId(id: string): boolean {
  return NOTICES.some((n) => n.id === id);
}

const NOTICE_PREFIX = 'wall_notice.';
const SHOW_BACKGROUND = 'wall_show_background_sessions';

/**
 * The wall's server-wide display settings: one on/off switch per notice (default on) and whether background
 * sessions are shown (default off). They live in the settings table with the other Admin settings, so they
 * apply to every browser and survive a restart. `onChange` lets the fleet tell open browsers.
 */
export class WallSettings {
  constructor(
    private readonly db: DatabaseSync,
    private readonly onChange: () => void = () => {},
  ) {}

  private get(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value;
  }

  private set(key: string, value: string): boolean {
    const was = this.get(key);
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
    return was !== value;
  }

  noticeOn(id: string): boolean {
    return this.get(NOTICE_PREFIX + id) !== '0';
  }

  /** Returns false for an id that is not a known notice. */
  setNotice(id: string, on: boolean): boolean {
    if (!isNoticeId(id)) return false;
    if (this.set(NOTICE_PREFIX + id, on ? '1' : '0')) this.onChange();
    return true;
  }

  showBackgroundSessions(): boolean {
    return this.get(SHOW_BACKGROUND) === '1';
  }

  setShowBackgroundSessions(on: boolean): void {
    if (this.set(SHOW_BACKGROUND, on ? '1' : '0')) this.onChange();
  }

  view(): WallSettingsView {
    const notices: Record<string, boolean> = {};
    for (const n of NOTICES) notices[n.id] = this.noticeOn(n.id);
    return { notices, showBackgroundSessions: this.showBackgroundSessions() };
  }
}
