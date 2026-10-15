// The orchestrator page's three charts fill the height of their row (#197). jsdom does not lay
// anything out, so these read the rules out of fleet.css.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/fleet/fleet.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

describe("orchestrator charts fill their row (#197)", () => {
  it("each chart cell is a column, so the title stays on top and the axis labels sit on the bottom", () => {
    const hc = rule(".podium .hc");
    expect(hc).toMatch(/display:\s*flex/);
    expect(hc).toMatch(/flex-direction:\s*column/);
  });

  it("the graph takes the space between, and is never smaller than 46px", () => {
    const svg = rule(".podium .hc svg");
    expect(svg).toMatch(/flex:\s*1\b/);
    expect(svg).toMatch(/min-height:\s*46px/);
    expect(svg).not.toMatch(/(^|[;\s])height:\s*46px/);
  });

  it("the three cells stretch to one height", () => {
    expect(rule(".podium .hcs")).toMatch(/display:\s*flex/);
    expect(rule(".podium .hcs")).not.toMatch(/align-items:\s*(flex-start|start|center)/);
    expect(rule(".podium .hc")).not.toMatch(/align-self/);
  });
});
