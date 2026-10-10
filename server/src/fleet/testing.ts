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

/** The shared fixture typed as a Report (it is valid; protocol.test.ts proves it). */
export function fixtureReport(): Report {
  return loadFixture() as unknown as Report;
}
