#!/usr/bin/env -S npx tsx
// Checks WCAG contrast for every color theme and mode in the UI. Run with --help.
import { readFileSync } from 'node:fs';

const HELP = `theme-contrast: check text and mark contrast for each theme and mode.

Usage: npx tsx scripts/theme-contrast.ts [options]

Reads the token blocks in frontend/src/fleet/fleet.css (Podium) and themes.css (the rest).
Checks, on --bg and --surface:
  text     ink, ink2, muted, good-text, crit-text,
           deleg-text, admin-text                                     need 4.5:1
  marks    good, warn, serious, crit, deleg, opus,
           sonnet, haiku, fable                                    need 3:1, or Podium's own ratio for the
                                                           same mode when that is lower (parity)
  models   the four model colors must differ from each other (OKLab distance, need 0.08)

Options:
  --json    Print results as JSON
  --quiet   Print only failures
  -h, --help
Exits 1 if any check fails.`;

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
const json = args.includes('--json');
const quiet = args.includes('--quiet');

const dir = new URL('../frontend/src/fleet/', import.meta.url);
const fleet = readFileSync(new URL('fleet.css', dir), 'utf8');
const themes = readFileSync(new URL('themes.css', dir), 'utf8');

type Tokens = Record<string, string>;

function parseBlock(body: string): Tokens {
  const t: Tokens = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) t[m[1]] = m[2].trim();
  return t;
}

// Podium: the dark base is the first .podium block; light is the [data-theme="light"] override.
function podium(): Record<string, Tokens> {
  const dark = parseBlock(/\n\.podium \{([\s\S]*?)\n\}/.exec(fleet)![1]);
  const light = { ...dark, ...parseBlock(/:root\[data-theme="light"\] \.podium \{([\s\S]*?)\n\}/.exec(fleet)![1]) };
  return { 'podium/dark': dark, 'podium/light': light };
}

function others(): Record<string, Tokens> {
  const out: Record<string, Tokens> = {};
  for (const m of themes.matchAll(/:root\[data-theme-name="([a-z]+)"\]\[data-theme="(dark|light)"\],\n[^\n]*\{([\s\S]*?)\n\}/g)) {
    out[`${m[1]}/${m[2]}`] = parseBlock(m[3]);
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255) as [number, number, number];
}
const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const dist = (a: string, b: string) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]) as [number, number, number]);

type Result = { palette: string; check: string; value: number; need: number; ok: boolean };
const results: Result[] = [];
const add = (palette: string, check: string, value: number, need: number) => results.push({ palette, check, value: Math.round(value * 100) / 100, need, ok: value >= need });

const base = podium();
const MARKS = ['good', 'warn', 'serious', 'crit', 'deleg', 'opus', 'sonnet', 'haiku', 'fable'];
for (const [name, t] of Object.entries({ ...base, ...others() })) {
  const ref = base[`podium/${name.split('/')[1]}`];
  for (const bgName of ['bg', 'surface']) {
    const bg = t[bgName];
    for (const k of ['ink', 'ink2', 'muted', 'good-text', 'crit-text', 'deleg-text', 'admin-text']) add(name, `${k} on ${bgName}`, ratio(t[k], bg), 4.5);
    for (const k of MARKS) add(name, `${k} on ${bgName}`, ratio(t[k], bg), Math.min(3, Math.floor(ratio(ref[k], ref[bgName]) * 100) / 100));
  }
  const m = ['opus', 'sonnet', 'haiku', 'fable'];
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) add(name, `${m[i]} vs ${m[j]}`, dist(t[m[i]], t[m[j]]), 0.08);
}

if (json) console.log(JSON.stringify(results, null, 2));
else {
  const shown = quiet ? results.filter((r) => !r.ok) : results;
  for (const r of shown) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.palette.padEnd(16)} ${r.check.padEnd(22)} ${String(r.value).padStart(6)} (need ${r.need})`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length} checks, ${bad} failing`);
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
