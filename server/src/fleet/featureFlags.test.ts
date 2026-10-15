import { describe, it, expect, vi } from 'vitest';
import { openDb } from './db.js';
import { ACTIVITY_FEED, FEATURES, FeatureFlags, isFeatureId, RESPOND } from './featureFlags.js';

describe('FeatureFlags', () => {
  it('lists the activity feed first, on by default, and Respond from Podium after it, off by default (#206)', () => {
    expect(FEATURES[0]).toMatchObject({ id: ACTIVITY_FEED, name: 'Agent activity feed', defaultOn: true });
    expect(FEATURES[1]).toMatchObject({
      id: RESPOND,
      name: 'Respond from Podium',
      description: 'Lets people answer and message the sessions they own. Each answer is written to the admin log with who sent it.',
      defaultOn: false,
    });
    expect(ACTIVITY_FEED).toBe('activity-feed');
    expect(RESPOND).toBe('respond');
    const flags = new FeatureFlags(openDb(':memory:'));
    expect(flags.view()).toEqual({ 'activity-feed': true, respond: false });
  });

  it('turns the off-by-default flag on and off, firing onChange only on a change', () => {
    const db = openDb(':memory:');
    const changed = vi.fn();
    const flags = new FeatureFlags(db, changed);
    flags.setFeature(RESPOND, false);
    expect(changed).not.toHaveBeenCalled();
    flags.setFeature(RESPOND, true);
    expect(changed).toHaveBeenCalledWith(RESPOND, true);
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('feature.respond')).toEqual({ value: '1' });
    expect(new FeatureFlags(db).featureOn(RESPOND)).toBe(true);
    flags.setFeature(RESPOND, false);
    expect(new FeatureFlags(db).featureOn(RESPOND)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('turns a flag off and on, fires onChange only on a change, and keeps it across a restart', () => {
    const db = openDb(':memory:');
    const changed = vi.fn();
    const flags = new FeatureFlags(db, changed);
    expect(flags.setFeature(ACTIVITY_FEED, false)).toBe(true);
    expect(flags.featureOn(ACTIVITY_FEED)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    flags.setFeature(ACTIVITY_FEED, false);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('feature.activity-feed')).toEqual({ value: '0' });
    expect(new FeatureFlags(db).featureOn(ACTIVITY_FEED)).toBe(false);
    flags.setFeature(ACTIVITY_FEED, true);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(new FeatureFlags(db).featureOn(ACTIVITY_FEED)).toBe(true);
  });

  it('refuses an id that is not a known flag and changes nothing', () => {
    const db = openDb(':memory:');
    const changed = vi.fn();
    const flags = new FeatureFlags(db, changed);
    expect(isFeatureId('nope')).toBe(false);
    expect(flags.setFeature('nope', false)).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'feature.%'").get()).toEqual({ n: 0 });
  });
});
