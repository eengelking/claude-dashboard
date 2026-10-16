// Test helpers shared by the fleet test files. Not used at run time.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Report } from './protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

/** The shared fixture as raw JSON (for validator tests that mutate it). */
export function loadFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs', 'fixtures', 'report.sample.json'), 'utf8'));
}

/** The 0.14 fields that change what the server does with a report: they open asks, name an owner and a machine, hold an idle session. */
const SITUATIONAL_SESSION = ['clearedFrom', 'activityFeed', 'activity', 'background', 'respond', 'asks'] as const;

/**
 * The shared fixture without the fields that start behavior of their own (open asks, an owner, a machine, background work,
 * a live activity feed), still on the current reporter version. Most tests want a plain running session; the ones that
 * test those fields add them back, or read the whole fixture with loadFixture().
 */
export function bareFixture(): Record<string, unknown> {
  const f = loadFixture() as { session: Record<string, unknown>; agents: Record<string, unknown>[] } & Record<string, unknown>;
  for (const k of SITUATIONAL_SESSION) delete f.session[k];
  for (const a of f.agents) delete a.activity;
  delete f.userName;
  delete f.machine;
  return f;
}

/** The plain fixture typed as a Report (protocol.test.ts proves the full fixture valid; the fields left out are optional). */
export function fixtureReport(): Report {
  return bareFixture() as unknown as Report;
}
