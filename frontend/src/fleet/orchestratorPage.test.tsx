// The orchestrator page's summary surface (#165, mockup/podium-orchestrator.html): header, facts and the status band are one
// bordered surface, with the band last. The callouts are gone; the blowout alert opens from the Blowouts cell.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { FocusView } from "./components/FocusView";
import { HOOKS_NOTE, versionNote } from "./components/SessionCard";
import { makeAgent, makeSession } from "./fixtures";
import type { LifecycleConfig, SessionView } from "./types";

afterEach(cleanup);

const CFG: LifecycleConfig = { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000, detachedHideAfterMs: 60_000 };
const NOW = 2_000_000;

function page(over: Partial<SessionView> = {}, opts: { now?: number; remove?: boolean; onAgent?: (id: string) => void } = {}) {
  const onRemove = opts.remove === false ? undefined : vi.fn();
  const utils = render(
    <FocusView
      s={makeSession(over)}
      now={opts.now ?? NOW}
      config={CFG}
      sort={{ key: null, dir: 1 }}
      onSort={() => {}}
      selectedAgent={null}
      flashAgent={null}
      onAgent={opts.onAgent ?? (() => {})}
      onRemove={onRemove}
    />,
  );
  const c = utils.container;
  return { ...utils, onRemove, surface: c.querySelector(".osum") as HTMLElement, band: c.querySelector(".osum .band") as HTMLElement };
}

const blow = (orch: number, agents: number, level: 0 | 1 | 2) => ({ orchestrator: orch, agents, total: orch + agents, level, loopsHit: 1, loopsTotal: 3, log: [] });
const task = (type: "shell" | "agent", description = "nightly build") => ({ type, description, status: "running" });
const nested = [makeAgent({ id: "p", description: "Parent agent" }), makeAgent({ id: "c", parentId: "p", description: "Child agent" })];

describe("the summary surface", () => {
  it("is one surface: header, then the facts, then the band as the last thing on it", () => {
    const { surface } = page();
    expect([...surface.children].map((e) => e.className.split(" ")[0])).toEqual(["fh", "facts", "band"]);
  });

  it("keeps the band last in every state, with the blowout alert between the header and the facts when opened", () => {
    const cases: Partial<SessionView>[] = [
      {},
      { status: "done" },
      { status: "waiting", waitReason: "input" },
      { status: "waiting", waitReason: "permission", background: { tasks: [task("shell")], wakeAt: null } },
      { status: "stale", dropAt: NOW + 37_000 },
      { agents: nested },
      { plan: null, agents: [], reporter: "hooks", reporterVersion: null },
      { blowouts: blow(0, 2, 2) },
    ];
    for (const over of cases) {
      const { surface, container } = page(over);
      expect(surface.lastElementChild!.className, JSON.stringify(over)).toContain("band");
      cleanup();
      void container;
    }
    const { surface, container } = page({ blowouts: blow(0, 2, 2) });
    fireEvent.click(within(container).getByRole("button", { name: /Blowouts/ }));
    expect([...surface.children].map((e) => e.className.split(" ")[0])).toEqual(["fh", "bdet", "facts", "band"]);
  });

  it("has none of the old callouts, alerts or the status chip beside the name", () => {
    for (const over of [{ status: "stale" as const, dropAt: NOW + 37_000 }, { status: "waiting" as const, waitReason: "input" as const }, { reporter: "hooks" as const, reporterVersion: null }, { reporterVersion: "0.3.0", compat: "outdated" as const }, { blowouts: blow(1, 2, 2) }]) {
      const { container } = page(over);
      expect(container.querySelector(".callout"), JSON.stringify(over)).toBeNull();
      expect(container.querySelector(".alert")).toBeNull();
      expect(container.querySelector(".fh h1 .st")).toBeNull();
      cleanup();
    }
  });
});

describe("the status band", () => {
  it("says Running in a light band, with the play shape beside the name too", () => {
    const { band, container } = page();
    expect(band.textContent).toBe("Running");
    expect(band).toHaveClass("running");
    expect(band).not.toHaveClass("hot");
    expect(container.querySelector(".fh h1 .sd .si-running")).not.toBeNull();
    expect(band.querySelector(".bi .si-running")).not.toBeNull();
  });

  it("says Done with the check shape", () => {
    const { band, container } = page({ status: "done" });
    expect(band.textContent).toBe("Done");
    expect(band).toHaveClass("done");
    expect(container.querySelector(".fh h1 .sd .si-done")).not.toBeNull();
  });

  it("a waiting session gets the heavy tint, the sentence, and where to answer with what it waits on", () => {
    const { band, container } = page({ status: "waiting", waitReason: "permission", waitNote: "Bash(npm test)" });
    expect(band).toHaveClass("waiting", "hot");
    expect(band.querySelector(".bl")!.textContent).toBe("Waiting for your approval.");
    expect(band.querySelector(".bd")!.textContent).toBe("Answer in its terminal. Tool: Bash");
    expect(container.querySelector(".fh h1 .sd .si-waiting")).not.toBeNull();
  });

  it("a waiting session with no note still says where to answer", () => {
    const { band } = page({ status: "waiting", waitReason: "input" });
    expect(band.querySelector(".bl")!.textContent).toBe("Waiting for your input.");
    expect(band.querySelector(".bd")!.textContent).toBe("Answer in its terminal.");
  });

  it("a background wait is calm: the sentence, the cut task description, the full text as the tooltip", () => {
    const { band, container } = page({ status: "waiting", waitReason: null, background: { tasks: [task("shell", "nightly build")], wakeAt: null } });
    expect(band).toHaveClass("bg");
    expect(band).not.toHaveClass("hot");
    expect(band.querySelector(".bl")!.textContent).toBe("Waiting for 1 background shell to finish.");
    expect(band.querySelector(".bd")!.textContent).toBe("Shell: nightly build");
    expect(band.textContent).not.toContain("Answer in its terminal");
    expect(band.getAttribute("title")).toContain("Not waiting on you");
    expect(container.querySelector(".fh h1 .sd .si-bg")).not.toBeNull();
  });

  it("heartbeat lost: the age and countdown without a space before the unit, the explanation, a heavy tint", () => {
    const { band, container } = page({ status: "stale", lastSeenAt: NOW - 38_000, dropAt: NOW + 37_000 });
    expect(band).toHaveClass("stale", "hot");
    expect(band.querySelector(".bl")!.textContent).toBe("No heartbeat for 0:38. Goes away in 37s.");
    expect([...band.querySelectorAll(".bl .mono")].map((e) => e.textContent)).toEqual(["0:38", "37s"]);
    expect(band.querySelector(".bd")!.textContent).toBe("The session may have crashed or been closed without a clean exit.");
    expect(container.querySelector(".fh h1 .sd .si-stale")).not.toBeNull();
  });

  it("Remove now is its own element laid over the right end of the band, not part of the text, and calls onRemove", () => {
    const { band, onRemove } = page({ status: "stale", dropAt: NOW + 37_000 });
    const btn = band.querySelector("button")!;
    expect(btn.textContent).toBe("Remove now");
    expect(btn.parentElement).toBe(band);
    expect(band.querySelector(".bt")!.contains(btn)).toBe(false);
    expect(band).toHaveClass("has-rm");
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledWith("s1");
  });

  it("offers no Remove now to a viewer who cannot remove, and reserves no room for it", () => {
    const { band } = page({ status: "stale", dropAt: NOW + 37_000 }, { remove: false });
    expect(band.querySelector("button")).toBeNull();
    expect(band).not.toHaveClass("has-rm");
  });

  it("only a heartbeat-lost session has Remove now", () => {
    expect(page().band.querySelector("button")).toBeNull();
  });

  it("delegating shows on this page: the ring shape beside the name and in the band, naming the agents, in a calm tint", () => {
    const { band, container } = page({ agents: nested });
    expect(band).toHaveClass("deleg");
    expect(band).not.toHaveClass("hot");
    expect(band.querySelector(".bl")!.textContent).toBe("Delegating to 1 agent.");
    expect(band.querySelector(".bd")!.textContent).toBe("Parent agent");
    expect(band.getAttribute("title")).toBe("Waiting on 1 agent: Parent agent. Not waiting on you.");
    expect(container.querySelector(".fh h1 .sd .si-deleg")).not.toBeNull();
  });

  it("delegating counts every agent the orchestrator waits on", () => {
    const { band } = page({ agents: [makeAgent({ id: "a", description: "One" }), makeAgent({ id: "b", description: "Two" })] });
    expect(band.querySelector(".bl")!.textContent).toBe("Delegating to 2 agents.");
    expect(band.querySelector(".bd")!.textContent).toBe("One, Two");
  });

  it("the session's own waiting status wins over delegating", () => {
    const { band } = page({ status: "waiting", waitReason: "input", agents: nested });
    expect(band).toHaveClass("waiting");
    expect(band.textContent).not.toContain("Delegating");
  });

  it("failed agents do not change the band", () => {
    const { band, container } = page({ agents: [makeAgent({ id: "f", status: "failed" })] });
    expect(band.textContent).toBe("Running");
    expect(container.querySelector(".facts button.blow")!.textContent).toBe("1 failed");
  });
});

describe("the facts grid", () => {
  const labels = (c: HTMLElement) => [...c.querySelectorAll(".osum .facts > .fact")].map((f) => f.querySelector(".k")!.textContent);

  it("has eight fixed places: four in each row", () => {
    const { container } = page();
    expect(labels(container)).toEqual(["Agents", "Est. cost", "Tokens", "Running for", "Agent time", "Blowouts", "Reporter", "Resume"]);
  });

  it("keeps the same eight places whatever the session holds", () => {
    for (const over of [{ blowouts: blow(1, 0, 1) }, { reporter: "hooks" as const, reporterVersion: null }, { status: "done" as const }]) {
      expect(labels(page(over).container), JSON.stringify(over)).toHaveLength(8);
      cleanup();
    }
  });
});

describe("the Blowouts cell", () => {
  const cell = (c: HTMLElement) => [...c.querySelectorAll(".facts > .fact")].find((f) => f.querySelector(".k")!.textContent === "Blowouts") as HTMLElement;

  it("reads none, muted and not a control, when nothing blew out", () => {
    const { container } = page();
    const c = cell(container);
    expect(c.querySelector(".v")!.textContent).toBe("none");
    expect(c.tagName).toBe("DIV");
    expect(container.querySelector(".osum")).not.toHaveClass("risk");
  });

  it("at level 1 is a closed amber button with a warning shape and the count", () => {
    const { container } = page({ blowouts: blow(0, 1, 1) });
    const c = cell(container);
    expect(c.tagName).toBe("BUTTON");
    expect(c.getAttribute("aria-expanded")).toBe("false");
    expect(c.querySelector(".blow svg")).not.toBeNull();
    expect(c.querySelector(".blow")!.textContent).toContain("1×");
    expect(c.querySelector(".blow")).not.toHaveClass("l2");
    expect(container.querySelector(".osum")).not.toHaveClass("risk");
    expect(container.querySelector(".bdet")).toBeNull();
  });

  it("opens and closes the detail it controls", () => {
    const { container } = page({ blowouts: blow(0, 1, 1), agents: [makeAgent({ id: "k", description: "Kid one", blowouts: 1 })] });
    const c = cell(container);
    fireEvent.click(c);
    expect(c.getAttribute("aria-expanded")).toBe("true");
    const detail = container.querySelector(".bdet") as HTMLElement;
    expect(detail.id).toBe(c.getAttribute("aria-controls"));
    expect(detail.textContent).toContain("A context window was exceeded.");
    expect(detail.textContent).toContain("Kid one");
    fireEvent.click(c);
    expect(c.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".bdet")).toBeNull();
  });

  it("the loops in the detail are links that open the agent", () => {
    const onAgent = vi.fn();
    const { container } = page({ blowouts: blow(1, 2, 2), agents: [makeAgent({ id: "k", description: "Kid one", blowouts: 2 })] }, { onAgent });
    fireEvent.click(cell(container));
    expect(container.querySelector(".bdet")!.textContent).toContain("Repeated context blowouts");
    expect(container.querySelector(".bdet")!.textContent).toContain("Orchestrator: 1×");
    fireEvent.click(within(container.querySelector(".bdet") as HTMLElement).getByRole("button", { name: "Kid one" }));
    expect(onAgent).toHaveBeenCalledWith("k");
  });

  it("at level 2 is red, and the whole surface takes the card's red top edge, open or closed", () => {
    const { container } = page({ blowouts: blow(0, 3, 2) });
    expect(cell(container).querySelector(".blow")).toHaveClass("l2");
    expect(container.querySelector(".osum")).toHaveClass("risk");
  });
});

describe("the Reporter cell", () => {
  const cell = (c: HTMLElement) => [...c.querySelectorAll(".facts > .fact")].find((f) => f.querySelector(".k")!.textContent === "Reporter") as HTMLElement;

  it("shows the version", () => {
    expect(cell(page({ reporterVersion: "0.11.0" }).container).querySelector(".v")!.textContent).toBe("0.11.0");
  });

  it("says Settings hooks, and its tooltip carries the note and how to load the mod", () => {
    const c = cell(page({ reporter: "hooks", reporterVersion: null }).container);
    expect(c.querySelector(".v")!.textContent).toBe("Settings hooks");
    expect(c.getAttribute("title")).toContain(HOOKS_NOTE);
    expect(c.getAttribute("title")).toContain("Install podium-reporter from eengelking-marketplace for the full view.");
  });

  it("out of range: the card chip's label in the warning color with a warning shape, the note as its tooltip", () => {
    const s = makeSession({ reporterVersion: "0.3.0", compat: "outdated" });
    const c = cell(page({ reporterVersion: "0.3.0", compat: "outdated" }).container);
    expect(c.querySelector(".v")!.textContent).toBe("0.3.0 · update");
    expect(c).toHaveClass("warn");
    expect(c.querySelector(".v svg")).not.toBeNull();
    expect(c.getAttribute("title")).toBe(versionNote(s)!.text);
  });
});

describe("the Resume cell", () => {
  it("is a quiet whole-cell control: the label Resume over Copy command and a copy icon", () => {
    const { container } = page();
    const c = [...container.querySelectorAll(".facts > .fact")].find((f) => f.querySelector(".k")!.textContent === "Resume") as HTMLElement;
    const btn = c.querySelector("button")!;
    expect(btn.querySelector(".k")!.textContent).toBe("Resume");
    expect(btn.querySelector(".v")!.textContent).toBe("Copy command");
    expect(btn.querySelector(".v svg")).not.toBeNull();
    expect(btn.getAttribute("title")).toMatch(/resumes this session/);
  });
});

describe("page layout CSS (#165)", () => {
  const css = readFileSync(resolve(process.cwd(), "src/fleet/fleet.css"), "utf8");
  const rule = (sel: string) => css.split("\n").find((l) => l.startsWith(`${sel} {`)) ?? "";
  const container = (query: string) => {
    const at = css.indexOf(`@container ${query} {`);
    if (at < 0) return "";
    const end = css.indexOf("\n}", at);
    return css.slice(at, end);
  };

  it("the band is a fixed 58 px minimum, the surface's last row, and Remove is laid over its right end", () => {
    expect(rule(".podium .osum .band")).toContain("min-height: 58px");
    expect(rule(".podium .osum .band")).toContain("position: relative");
    expect(rule(".podium .osum .band.has-rm")).toMatch(/padding-right: \d+px/);
    expect(rule(".podium .osum .band .rm")).toContain("position: absolute");
  });

  it("the facts are a grid of four columns, two rows", () => {
    const r = rule(".podium .osum .facts");
    expect(r).toContain("display: grid");
    expect(r).toMatch(/grid-template-columns: ([^;]+ ){3}[^;]+;/);
    expect(r.match(/grid-template-columns: ([^;]+);/)![1]!.trim().split(/\s+/)).toHaveLength(4);
  });

  it("the facts become two columns at 520 px and the plan and tree stack at 700 px, by the page's own width", () => {
    expect(rule(".podium .op")).toContain("container-type: inline-size");
    expect(container("(max-width: 520px)")).toMatch(/\.facts \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(container("(max-width: 700px)")).toMatch(/\.two[^{]*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  });

  it("a level 2 blowout gives the surface the card's red edge", () => {
    expect(rule(".podium .osum.risk")).toContain("border-color: var(--crit)");
    expect(rule(".podium .osum.risk")).toContain("inset 0 3px 0 var(--crit)");
  });

  it("the delegating band is the blue of the other calm waits; the heavier tint is only for waiting and heartbeat lost", () => {
    expect(rule(".podium .band.deleg")).toContain("--deleg");
  });

  it("the old callout, alert and inline Remove rules are gone", () => {
    expect(css).not.toMatch(/\.podium \.alert/);
    expect(css).not.toContain(".remove-inline");
  });
});
