import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { SessionCard } from "./components/SessionCard";
import { makeEvent, makeSession } from "./fixtures";
import { stateFrom } from "./testState";
import { backgroundLead, backgroundTitle } from "./waiting";

afterEach(cleanup);

// A session idle on background work is not waiting on the person (#119, mockup/podium-background-wait.html).
const CFG = { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000, detachedHideAfterMs: 60_000 };
const task = (type: "shell" | "agent" | "monitor" | "workflow" | "wakeup", description = "nightly build") => ({ type, description, status: "running" });
const idleOn = (tasks: ReturnType<typeof task>[], wakeAt: number | null = null) =>
  makeSession({ status: "waiting", waitReason: null, background: { tasks, wakeAt } });
const renderCard = (s = idleOn([task("shell")])) => render(<SessionCard s={s} now={2_000_000} config={CFG} entering={false} leaving={false} onOpen={() => {}} />);

describe("backgroundLead", () => {
  it("counts by kind", () => {
    expect(backgroundLead({ tasks: [task("shell")], wakeAt: null })).toBe("Waiting for 1 background shell to finish.");
    expect(backgroundLead({ tasks: [task("shell"), task("shell")], wakeAt: null })).toBe("Waiting for 2 background shells to finish.");
    expect(backgroundLead({ tasks: [task("agent")], wakeAt: null })).toBe("Waiting for 1 background agent to finish.");
    expect(backgroundLead({ tasks: [task("monitor")], wakeAt: null })).toBe("Waiting for 1 background monitor to finish.");
    expect(backgroundLead({ tasks: [task("workflow")], wakeAt: null })).toBe("Waiting for 1 background workflow to finish.");
  });
  it("lists several kinds in one sentence", () => {
    expect(backgroundLead({ tasks: [task("shell"), task("agent")], wakeAt: null })).toBe("Waiting for 1 background shell and 1 background agent to finish.");
  });
  it("names a wake-up that comes with other work, and the tooltip says wake-up, not wakeup", () => {
    const b = { tasks: [task("shell"), task("wakeup", "check the deploy")], wakeAt: null };
    expect(backgroundLead(b)).toBe("Waiting for 1 background shell to finish, and a scheduled wake-up.");
    expect(backgroundTitle(b)).not.toContain("wakeup");
    expect(backgroundTitle(b)).toContain("wake-up: check the deploy");
  });
  it("says when a scheduled wake-up will wake, or that one is scheduled", () => {
    expect(backgroundLead({ tasks: [task("wakeup", "check the deploy")], wakeAt: Date.UTC(2026, 9, 13, 14, 30) })).toMatch(/^Waiting for a scheduled wake-up at \d{1,2}:\d{2}\.$/);
    expect(backgroundLead({ tasks: [task("wakeup", "check the deploy")], wakeAt: null })).toBe("Waiting for a scheduled wake-up.");
  });
});

describe("the card", () => {
  it("says what it waits on, never \"your input\", and carries no task description", () => {
    const { container } = renderCard(idleOn([task("shell", "npm run build:all && npm run test:integration -- --runInBand --coverage")]));
    expect(container.querySelector(".band")!.textContent).toBe("Waiting for 1 background shell to finish.");
    expect(container.textContent).not.toContain("your input");
    expect(container.textContent).not.toContain("npm run build");
  });

  it("is blue and quiet: a dashed-ring clock, not the waiting-on-you mark, and no amber band", () => {
    const { container } = renderCard();
    expect(container.querySelector(".st")).toBeNull();
    expect(container.querySelector(".card .sd .si-bg")).not.toBeNull();
    expect(container.querySelector(".card .sd .si-waiting")).toBeNull();
    expect(container.querySelector(".band .si-bg")).not.toBeNull();
    expect(container.querySelector(".band")!.className).toContain("bg");
    expect(container.querySelector(".band")!.className).not.toContain("hot");
  });

  it("a session that waits on the person still reads as before", () => {
    const { container } = renderCard(makeSession({ status: "waiting", waitReason: "input" }));
    expect(container.querySelector(".band")!.textContent).toBe("Waiting for your input.");
    expect(container.querySelector(".band")!.className).toContain("waiting");
    expect(container.querySelector(".band")!.className).toContain("hot");
    expect(container.querySelector(".card .sd .si-waiting")).not.toBeNull();
  });

  it("a permission wait wins over background work", () => {
    const { container } = renderCard(makeSession({ status: "waiting", waitReason: "permission", waitNote: "Bash(rm x)", background: { tasks: [task("shell")], wakeAt: null } }));
    expect(container.querySelector(".band")!.textContent).toBe("Waiting for your approval.");
  });
});

describe("the orchestrator page", () => {
  it("leads with the sentence and puts the task description on its own row", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [idleOn([task("shell", "nightly build")])] })} />);
    fireEvent.click(container.querySelector(".wall .card")!);
    const callout = container.querySelector(".osum .band")!;
    expect(callout.querySelector(".bl")!.textContent).toBe("Waiting for 1 background shell to finish.");
    expect(callout.querySelector(".bd")!.textContent).toBe("Shell: nightly build");
    expect(callout.textContent).not.toContain("Answer in its terminal");
  });

  it("cuts a long description at a character limit and ends it with a space and three dots", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [idleOn([task("shell", "npm run build:all && npm run test:integration -- --runInBand --coverage --reporters=default --reporters=jest-junit")])] })} />);
    fireEvent.click(container.querySelector(".wall .card")!);
    const detail = container.querySelector(".osum .band .bd")!.textContent!;
    expect(detail.length).toBeLessThanOrEqual(64 + 4);
    expect(detail).toMatch(/\S \.\.\.$/);
  });
});

describe("the counts", () => {
  it("do not count a session idle on background work as waiting on you", () => {
    const sessions = [makeSession({ id: "a", name: "needs-you", status: "waiting", waitReason: "input" }), { ...idleOn([task("shell")]), id: "b", name: "on-shell" }];
    const { container } = render(<FleetView state={stateFrom({ sessions })} />);
    expect(container.textContent).toContain("0 running · 1 waiting · 0 stale");
  });

  it("the rail row says what it waits on", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [idleOn([task("shell")])] })} />);
    const row = [...container.querySelectorAll(".rail .ritem")].find((r) => r.textContent?.includes("api-refactor"))!;
    expect(row.textContent).toContain("waiting on shell");
    expect(row.querySelector(".dot.ring")).not.toBeNull();
  });
});

describe("the activity feed", () => {
  it("the newest wait row is blue with a kind pill, like a wait on you is amber", () => {
    const events = [makeEvent({ id: "bg", t: 1_000_000, kind: "wait", text: "waiting on background: 1 shell" })];
    const { container } = render(<FleetView state={stateFrom({ sessions: [idleOn([task("shell")])], events })} />);
    const li = [...container.querySelectorAll(".side .ev li")].find((l) => l.querySelector(".lead"))!;
    expect(li.querySelector(".lead")!.textContent).toBe("Waiting for 1 background shell to finish.");
    expect(li.querySelector(".tool")!.textContent).toBe("shell");
    expect(li.className).toContain("bgw");
    expect(li.className).not.toMatch(/(^| )w( |$)/);
  });

  it("goes plain once the session is no longer waiting on that work", () => {
    const events = [makeEvent({ id: "bg", t: 1_000_000, kind: "wait", text: "waiting on background: 1 shell" })];
    const { container } = render(<FleetView state={stateFrom({ sessions: [makeSession({ status: "running" })], events })} />);
    const li = [...container.querySelectorAll(".side .ev li")].find((l) => l.textContent?.includes("background shell"))!;
    expect(li.className).not.toContain("bgw");
  });
});
