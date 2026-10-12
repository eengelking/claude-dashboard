import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { makeEvent, makeSession } from "./fixtures";
import { stateFrom } from "./testState";
import { parseWaitEvent, waitLead } from "./waiting";

afterEach(cleanup);

const QUESTION_JSON =
  'AskUserQuestion([{"question":"What card width do you want on the wall?","header":"Card width","options":[{"label":"360px (Recommended)","description":"Roomier t';

function feedRow(text: string, over: { status?: "waiting" | "running"; later?: boolean } = {}) {
  const events = [makeEvent({ id: "w", t: 1_000_000, kind: "wait", text })];
  if (over.later) events.unshift(makeEvent({ id: "n", t: 1_005_000, kind: "note", text: "resumed" }));
  const session = makeSession({ status: over.status ?? "waiting" });
  const { container } = render(<FleetView state={stateFrom({ sessions: [session], events })} />);
  const li = [...container.querySelectorAll(".side .ev li")].find((l) => l.querySelector(".lead") || l.textContent?.includes("waiting on you"))!;
  return { li, container };
}

describe("waiting rows in the activity feed (#68)", () => {
  it("shows a question as a plain input message with the tool name, never the raw call", () => {
    const { li } = feedRow(`waiting on you: ${QUESTION_JSON}`);
    expect(li.querySelector(".lead")!.textContent).toBe("Waiting for your input.");
    expect(li.querySelector(".tool")!.textContent).toBe("AskUserQuestion");
    expect(li.className).toContain("w");
    expect(li.textContent).not.toContain('{"question"');
    expect(li.textContent).not.toContain("Roomier");
  });

  it("shows a plan-mode exit and a Bash permission prompt as approval messages", () => {
    const plan = feedRow("waiting on you: ExitPlanMode(# Plan: Issue #24, effort as a colored indicator ## Context Reported by the maintainer)");
    expect(plan.li.querySelector(".lead")!.textContent).toBe("Waiting for your approval.");
    expect(plan.li.querySelector(".tool")!.textContent).toBe("ExitPlanMode");
    expect(plan.li.textContent).not.toContain("# Plan");
    cleanup();
    const bash = feedRow("waiting on you: Bash(npm run e2e -- --grep long)");
    expect(bash.li.querySelector(".lead")!.textContent).toBe("Waiting for your approval.");
    expect(bash.li.querySelector(".tool")!.textContent).toBe("Bash");
    expect(bash.li.textContent).not.toContain("npm run e2e");
  });

  it("names the tool when a settings hook reports only the bare tool name", () => {
    const { li } = feedRow("waiting on you: Bash");
    expect(li.querySelector(".lead")!.textContent).toBe("Waiting for your approval.");
    expect(li.querySelector(".tool")!.textContent).toBe("Bash");
  });

  it("reads a notification message by what it asks for, with no tool chip", () => {
    const perm = feedRow("waiting on you: Claude needs your permission to use Bash");
    expect(perm.li.querySelector(".lead")!.textContent).toBe("Waiting for your approval.");
    expect(perm.li.querySelector(".tool")).toBeNull();
    cleanup();
    const idle = feedRow("waiting on you: Claude is waiting for your input");
    expect(idle.li.querySelector(".lead")!.textContent).toBe("Waiting for your input.");
    expect(idle.li.querySelector(".tool")).toBeNull();
  });

  it("works with no note at all", () => {
    const { li } = feedRow("waiting on you: permission");
    expect(li.querySelector(".lead")!.textContent).toBe("Waiting for your approval.");
    expect(li.querySelector(".tool")).toBeNull();
  });

  it("drops back to the normal style, in the past tense, once the session logs a later event", () => {
    const { li } = feedRow(`waiting on you: ${QUESTION_JSON}`, { later: true });
    expect(li.querySelector(".lead")!.textContent).toBe("Waited for your input.");
    expect(li.className).not.toMatch(/\bw\b/);
    expect(li.className).toContain("ans");
  });

  it("drops back too when the session is no longer waiting", () => {
    const { li } = feedRow("waiting on you: Bash(ls)", { status: "running" });
    expect(li.querySelector(".lead")!.textContent).toBe("Waited for your approval.");
    expect(li.className).toContain("ans");
  });

  it("leaves other events as they were", () => {
    const events = [makeEvent({ id: "d", kind: "done", text: "finished: audit retry settings" })];
    const { container } = render(<FleetView state={stateFrom({ events })} />);
    const li = container.querySelector(".side .ev li")!;
    expect(li.textContent).toContain("finished: audit retry settings");
    expect(li.querySelector(".lead")).toBeNull();
  });
});

describe("waiting wording", () => {
  it("parses only waiting events", () => {
    expect(parseWaitEvent("finished: something")).toBeNull();
    expect(parseWaitEvent("waiting on you: Bash(ls)")).toEqual({ reason: "permission", tool: "Bash" });
    expect(parseWaitEvent(`waiting on you: ${QUESTION_JSON}`)).toEqual({ reason: "input", tool: "AskUserQuestion" });
  });

  it("uses one pair of sentences everywhere", () => {
    expect(waitLead("permission", "Bash")).toBe("Waiting for your approval.");
    expect(waitLead("permission", "AskUserQuestion")).toBe("Waiting for your input.");
    expect(waitLead("input", null)).toBe("Waiting for your input.");
    expect(waitLead(null, null)).toBe("Waiting on you.");
    expect(waitLead("permission", "Bash", true)).toBe("Waited for your approval.");
  });
});
