import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { DEFAULT_CHOICE, THEMES, effectiveTheme, parseChoice, resolveMode } from "./themes";

describe("themes", () => {
  it("ships Podium first and every theme has an id, a label, a credit and at least one mode", () => {
    expect(THEMES[0].id).toBe("podium");
    expect(THEMES.map((t) => t.id)).toEqual(["podium", "solarized", "nord", "gruvbox", "catppuccin", "github"]);
    for (const t of THEMES) {
      expect(t.label).not.toBe("");
      expect(t.modes.length).toBeGreaterThan(0);
      if (t.id !== "podium") expect(t.credit).toMatch(/MIT|license/i);
    }
  });

  it("parses stored values: old light/dark migrate to Podium, objects are validated, junk falls back", () => {
    expect(parseChoice("light")).toEqual({ theme: "podium", mode: "light" });
    expect(parseChoice("dark")).toEqual({ theme: "podium", mode: "dark" });
    expect(parseChoice({ theme: "nord", mode: "system" })).toEqual({ theme: "nord", mode: "system" });
    expect(parseChoice({ theme: "nope", mode: "dark" })).toEqual({ theme: "podium", mode: "dark" });
    expect(parseChoice({ theme: "nord", mode: "sepia" })).toEqual({ theme: "nord", mode: "system" });
    for (const junk of [null, undefined, 3, "blue", [], {}]) expect(parseChoice(junk)).toEqual(DEFAULT_CHOICE);
    expect(DEFAULT_CHOICE).toEqual({ theme: "podium", mode: "system" });
  });

  it("resolves system mode from the OS and leaves explicit modes alone", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });

  it("falls back to Podium's palette when a theme has no palette for the mode", () => {
    const list = [...THEMES, { id: "dracula", label: "Dracula", credit: "MIT", modes: ["dark"] as const }];
    expect(effectiveTheme("dracula", "dark", list)).toBe("dracula");
    expect(effectiveTheme("dracula", "light", list)).toBe("podium");
    expect(effectiveTheme("nord", "light", list)).toBe("nord");
    expect(effectiveTheme("missing", "dark", list)).toBe("podium");
  });

  it("keeps index.html's pre-paint script and themes.css in step with the list", () => {
    const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
    const css = readFileSync(resolve(__dirname, "themes.css"), "utf8");
    const others = THEMES.filter((t) => t.id !== "podium");
    expect(html).toContain(`/^(${others.map((t) => t.id).join("|")})$/`);
    for (const t of others) for (const m of t.modes) expect(css).toContain(`:root[data-theme-name="${t.id}"][data-theme="${m}"] .podium {`);
  });

  it("defines the delegating colors in Podium's blocks and in every palette block (#98)", () => {
    const fleet = readFileSync(resolve(__dirname, "fleet.css"), "utf8");
    const themes = readFileSync(resolve(__dirname, "themes.css"), "utf8");
    const blocks = (css: string) => css.split("}").filter((b) => /--bg:/.test(b));
    const all = [...blocks(fleet), ...blocks(themes)];
    expect(all.length).toBeGreaterThanOrEqual(13);
    for (const b of all) {
      expect(b, b.slice(0, 80)).toMatch(/--deleg:\s*#/);
      expect(b, b.slice(0, 80)).toMatch(/--deleg-text:\s*#/);
    }
  });
});
