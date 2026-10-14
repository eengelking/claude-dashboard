import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ActivityFeed } from "./ActivityFeed";
import { makeAgent, makeSession } from "../fixtures";
import type { ActivityReply } from "../useActivityFeed";

afterEach(cleanup);

const css = readFileSync(resolve(process.cwd(), "src/fleet/fleet.css"), "utf8");
const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/[.\[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m"))?.[1] ?? "";

const T0 = 1_000_000;
const fetchActivity = async (): Promise<ActivityReply> => ({ entries: [], since: T0, live: true, enabled: true, serverTime: T0 });

describe("the Activity header row lines up (#147)", () => {
  it("puts the label, Expand and the refresh control in one flex row, centred on each other", () => {
    const s = makeSession({ reporterVersion: "0.13.0", activityFeed: true, agents: [makeAgent({ id: "a1", startedAt: T0 })] });
    const { container } = render(<ActivityFeed s={s} loop="a1" title="t" startedAt={T0} active now={T0} fetchActivity={fetchActivity} />);
    const row = container.querySelector(".feedlab")!;
    expect(row.querySelector(":scope > .tools")!.textContent).toContain("Activity");
    expect(row.querySelector(":scope > .tools button.expand")).not.toBeNull();
    expect(row.querySelector(":scope > .live label.sub")!.textContent).toBe("Refresh every");
    expect(rule(".podium .det .lab.feedlab")).toMatch(/align-items:\s*center/);
  });

  it("does not inherit the toolbar's bottom margin, which pushed the left group above the right one", () => {
    expect(rule(".podium .tools")).toMatch(/margin-bottom:\s*12px/); // the generic toolbar row keeps it
    expect(rule(".podium .feedlab .tools")).toMatch(/margin:\s*0/);
  });

  it("gives Expand and the dropdown the same type size and the same height", () => {
    const size = (r: string) => r.match(/font-size:\s*([\d.]+px)/)?.[1];
    const expand = rule(".podium .expand");
    const select = rule(".podium .live select");
    expect(expand).not.toBe("");
    expect(select).not.toBe("");
    expect(size(expand)).toBeDefined();
    expect(size(expand)).toBe(size(select));
    expect(expand.match(/padding:\s*([^;]+)/)?.[1]).toBe(select.match(/padding:\s*([^;]+)/)?.[1]);
    expect(expand.match(/line-height:\s*([^;]+)/)?.[1]).toBeDefined();
    expect(expand.match(/line-height:\s*([^;]+)/)?.[1]).toBe(select.match(/line-height:\s*([^;]+)/)?.[1]);
  });
});
