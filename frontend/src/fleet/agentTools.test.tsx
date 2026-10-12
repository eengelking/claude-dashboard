import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentDetail } from "./components/AgentDetail";
import { makeAgent, makeSession } from "./fixtures";
import type { AgentView, SessionView } from "./types";

afterEach(cleanup);

const counts = { Bash: 18, Read: 12, Edit: 9, Grep: 7, Glob: 5, Write: 3, Agent: 1 };

function show(over: Partial<AgentView>) {
  const a = makeAgent({ id: "t", ...over });
  const s = makeSession({ agents: [a] });
  const r = render(<AgentDetail s={s} a={a} now={2_000_000} onBack={() => {}} onAgent={() => {}} />);
  const chips = () => [...r.container.querySelectorAll(".chip.tool")].map((c) => c.textContent!.replace(/\s+/g, " ").trim());
  return { ...r, chips };
}

describe("tool chips in the agent panel", () => {
  it("shows the five most used tools, most used first, with a Show all control", () => {
    const { chips } = show({ toolCounts: counts, toolCalls: 55, lastTool: "Grep" });
    expect(chips()).toEqual(["Bash 18", "Read 12", "Edit 9", "Grep 7 (last used)", "Glob 5"]);
    expect(screen.getByRole("button", { name: "Show all 7" })).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to every tool and goes back to five", () => {
    const { chips } = show({ toolCounts: counts, toolCalls: 55 });
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(chips()).toHaveLength(7);
    expect(chips().slice(5)).toEqual(["Write 3", "Agent 1"]);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(fewer);
    expect(chips()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show all 7" })).toBeInTheDocument();
  });

  it("shows the call total in the label, and the chip counts add up to it", () => {
    const { container } = show({ toolCounts: counts, toolCalls: 55 });
    expect(container.textContent).toContain("Tools used (55 calls)");
    expect(Object.values(counts).reduce((n, c) => n + c, 0)).toBe(55);
  });

  it("sorts ties by name so the order is stable", () => {
    const { chips } = show({ toolCounts: { Write: 2, Bash: 2, Read: 2, Glob: 5 }, toolCalls: 11, lastTool: null });
    expect(chips()).toEqual(["Glob 5", "Bash 2", "Read 2", "Write 2"]);
  });

  it("has no control when there are five tools or fewer", () => {
    show({ toolCounts: { Bash: 2, Read: 1 }, toolCalls: 3 });
    expect(screen.queryByRole("button", { name: /Show/ })).not.toBeInTheDocument();
  });

  it("marks the last tool on its chip and drops the separate Last tool line", () => {
    const { container, chips } = show({ toolCounts: { Bash: 2, Read: 1 }, toolCalls: 3, lastTool: "Read" });
    expect(container.querySelector(".chip.tool.latest")!.textContent).toContain("Read");
    expect(chips()).toEqual(["Bash 2", "Read 1 (last used)"]);
    expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).not.toContain("Last tool");
  });

  it("names the last tool beside the chips when it is not among the five shown", () => {
    const { container } = show({ toolCounts: counts, toolCalls: 55, lastTool: "Agent" });
    expect(container.querySelector(".chip.tool.latest")).toBeNull();
    expect(container.querySelector(".tools-latest")!.textContent).toContain("Agent");
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(container.querySelector(".chip.tool.latest")!.textContent).toContain("Agent");
    expect(container.querySelector(".tools-latest")).toBeNull();
  });

  it("says None seen when the agent has called no tools", () => {
    const { container, chips } = show({ toolCounts: {}, toolCalls: 0, lastTool: null });
    expect(chips()).toEqual([]);
    // once for the empty Tools used section, once for the empty Skills section
    expect(container.textContent!.match(/None seen/g)).toHaveLength(2);
  });

  it("falls back to today's Last tool line when the reporter sent no counts", () => {
    const { container } = show({ toolCounts: null, toolCalls: 18, lastTool: "Bash" });
    const dl = container.querySelector("dl")!;
    const dd = [...dl.querySelectorAll("dt")].find((d) => d.textContent === "Last tool")!.nextElementSibling!;
    expect(dd.textContent).toContain("Bash");
    expect(dd.textContent).toContain("18 calls");
    expect(container.querySelector(".chip.tool")).toBeNull();
    expect(container.textContent).not.toContain("Tools used");
  });

  it("renders a hostile tool name as text", () => {
    const { container } = show({ toolCounts: { '<img src=x onerror="window.__pwned=1">': 1 }, toolCalls: 1 });
    expect(container.querySelector(".chip.tool img")).toBeNull();
    expect(container.querySelector(".chip.tool")!.textContent).toContain("<img");
  });

  it("starts collapsed again for another agent", () => {
    const a1 = makeAgent({ id: "one", toolCounts: counts, toolCalls: 55 });
    const a2 = makeAgent({ id: "two", toolCounts: counts, toolCalls: 55 });
    const s = makeSession({ agents: [a1, a2] });
    const props = { s, now: 2_000_000, onBack: () => {}, onAgent: () => {} };
    const { container, rerender } = render(<AgentDetail {...props} a={a1} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(container.querySelectorAll(".chip.tool")).toHaveLength(7);
    rerender(<AgentDetail {...props} a={a2} />);
    expect(container.querySelectorAll(".chip.tool")).toHaveLength(5);
  });
});

describe("why the panel shows Last tool", () => {
  const NOTE = /tool counts need podium-reporter 0\.2\.0 or later/i;
  function panel(session: Partial<SessionView>, agent: Partial<AgentView>) {
    const a = makeAgent({ id: "t", ...agent });
    const s = makeSession({ agents: [a], ...session });
    return render(<AgentDetail s={s} a={a} now={2_000_000} onBack={() => {}} onAgent={() => {}} />);
  }

  it("explains the fallback and how to update when the mod is older than 0.2.0", () => {
    const { container } = panel({ reporter: "mod", reporterVersion: "0.1.0", compat: "outdated" }, { toolCounts: null, toolCalls: 11, lastTool: "Bash" });
    expect(container.textContent).toMatch(NOTE);
    expect(container.textContent).toContain("claude plugin update podium-reporter@eengelking-marketplace");
    expect(container.textContent).toContain("/reload-plugins");
    expect(container.textContent).toContain("Bash");
    expect(container.textContent).not.toContain("—");
  });

  it("still explains it when the server does not mark the old mod outdated", () => {
    const { container } = panel({ reporter: "mod", reporterVersion: "0.1.9", compat: "ok" }, { toolCounts: null });
    expect(container.textContent).toMatch(NOTE);
  });

  it("says nothing on a hooks-only session, which has no mod to update", () => {
    const { container } = panel({ reporter: "hooks", reporterVersion: null, compat: "ok" }, { toolCounts: null });
    expect(container.textContent).not.toMatch(NOTE);
    expect(container.textContent).toContain("Last tool");
  });

  it("says nothing when a current mod sent the counts", () => {
    const { container } = panel({ reporter: "mod", reporterVersion: "0.3.0" }, { toolCounts: { Bash: 2 }, toolCalls: 2 });
    expect(container.textContent).not.toMatch(NOTE);
    expect(container.querySelector(".chip.tool")).not.toBeNull();
  });

  it("says nothing on a current mod that has sent no counts yet", () => {
    const { container } = panel({ reporter: "mod", reporterVersion: "0.3.0" }, { toolCounts: null });
    expect(container.textContent).not.toMatch(NOTE);
  });
});
