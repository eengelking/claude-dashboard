import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkReporter } from "../server/src/fleet/compat";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("mod version", () => {
  // The mod reports VERSION to the server; plugin.json is what installed copies update on. A bump that
  // misses one makes reports claim the wrong version (CONTRIBUTING.md, "The mod version bump").
  it("register.ts VERSION matches plugin.json", () => {
    const manifest = JSON.parse(read("mod/podium-reporter/.claude-plugin/plugin.json")).version as string;
    const m = /export const VERSION = '([^']+)'/.exec(read("mod/podium-reporter/hooks/register.ts"));
    expect(m?.[1]).toBe(manifest);
  });
});

describe("supported reporter range", () => {
  // Without this, a mod minor bump that forgets REPORTER_SUPPORT.max makes every up-to-date mod show
  // "upgrade server" (SPEC 6.8, DECISIONS 18).
  it("includes the mod version in this repo", () => {
    const manifest = JSON.parse(read("mod/podium-reporter/.claude-plugin/plugin.json")).version as string;
    expect(checkReporter(manifest)).toBe("ok");
  });
});

describe("package versions", () => {
  it("root, server and frontend package.json agree", () => {
    const v = ["package.json", "server/package.json", "frontend/package.json"].map((p) => JSON.parse(read(p)).version);
    expect(new Set(v).size).toBe(1);
  });
});
