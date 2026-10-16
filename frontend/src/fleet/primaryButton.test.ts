// A primary button's label stays readable inside a modal, the answer panel and the composer (#216).
// jsdom does not run the cascade for these selectors, so this reads fleet.css: a context rule such as
// `.podium .modal.sm .btn` is more specific than `.podium .btn.pri`, so if it sets `color` it wins and the
// label ends up the same color as the button's own --ink background.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/fleet/fleet.css"), "utf8");

const CONTEXTS = [".ask", ".compose", ".modal.sm"];

describe("primary button label color (#216)", () => {
  it("a context rule that sets color on .btn leaves .btn.pri alone", () => {
    const offenders: string[] = [];
    for (const m of css.matchAll(/(?:^|\n)([^{}\n@][^{}]*)\{([^}]*)\}/g)) {
      const body = m[2]!;
      if (!/(^|[;\s])color\s*:/.test(body)) continue;
      for (const sel of m[1]!.split(",").map((s) => s.trim())) {
        const inContext = CONTEXTS.some((c) => sel.includes(`${c} .btn`));
        if (inContext && /\.btn$/.test(sel)) offenders.push(sel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the primary button still pairs --bg text with an --ink background", () => {
    expect(css).toMatch(/\.podium \.btn\.pri\s*\{[^}]*background:\s*var\(--ink\)[^}]*color:\s*var\(--bg\)/);
  });
});
