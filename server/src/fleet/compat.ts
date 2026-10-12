import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReporterCompat, ReporterSupport } from "./protocol.js";

/**
 * The reporter (mod) versions this server reads correctly. It changes only when the report format
 * or the mod's behaviour requires it, not on every release. Only major.minor is compared, so a
 * mod-only patch fix never warns.
 */
export const REPORTER_SUPPORT: ReporterSupport = { min: "0.2.0", max: "0.3.0" };

export type { ReporterCompat, ReporterSupport };

function minor(version: string | null | undefined): [number, number] | null {
  const m = /^(\d+)\.(\d+)\.\d+$/.exec(version ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function cmp(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

export function checkReporter(
  version: string | null | undefined,
  support: ReporterSupport = REPORTER_SUPPORT,
): ReporterCompat {
  const v = minor(version);
  const lo = minor(support.min);
  const hi = minor(support.max);
  if (!v || !lo || !hi) return "unknown";
  if (cmp(v, lo) < 0) return "outdated";
  if (cmp(v, hi) > 0) return "newer";
  return "ok";
}

let cached: string | null = null;

/** The server's own version, from server/package.json (the same relative path from src/ and dist/). */
export function serverVersion(): string {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "..", "package.json"), "utf8"));
    if (typeof pkg.version === "string") version = pkg.version;
  } catch {
    // keep "unknown"
  }
  cached = version;
  return version;
}
