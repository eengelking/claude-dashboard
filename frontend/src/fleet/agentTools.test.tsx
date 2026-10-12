import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentDetail } from "./components/AgentDetail";
import { makeAgent, makeSession } from "./fixtures";
import type { AgentView } from "./types";

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
});
