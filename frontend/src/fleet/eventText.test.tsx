import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { makeEvent } from "./fixtures";
import { stateFrom } from "./testState";
import { readableEvent } from "./eventText";
import type { ActivityView } from "./types";

afterEach(cleanup);

function row(over: Partial<ActivityView>) {
  const { container } = render(<FleetView state={stateFrom({ events: [makeEvent(over)] })} />);
  return container.querySelector(".side .ev li")!;
}

const CALL = 'Bash(psql "postgres://app:secret@localhost/billing" -c "select * from invoices where id in (1,2,3,4,5,6,7,8,9,10)")';

describe("other feed rows read as plain sentences (#68)", () => {
  it("a turn that ended after a failing call names the tool and leaves the call out", () => {
    const li = row({ kind: "fail", text: `orchestrator turn ended with an error after a failing call: ${CALL}`, data: { reason: "error", tool: "Bash", call: CALL, exitCode: 1 } });
    expect(li.querySelector(".tt")!.textContent).toContain("Turn ended with an error after a failing call.");
    expect(li.querySelector(".tool")!.textContent).toBe("Bash");
    expect(li.textContent).not.toContain("psql");
    expect(li.className).toContain("bad");
    expect(li.textContent).toContain("Show root cause");
  });

  it("an older stored failing-call event with no data shows the sentence and no chip", () => {
    const li = row({ kind: "fail", text: `orchestrator turn ended with an error after a failing call: ${CALL}`, data: null });
    expect(li.querySelector(".tt")!.textContent).toContain("Turn ended with an error after a failing call.");
    expect(li.querySelector(".tool")).toBeNull();
    expect(li.textContent).not.toContain("psql");
  });

  it("leaves an API error, a refusal and an agent failure as they were", () => {
    expect(row({ kind: "fail", text: "orchestrator turn ended with an API error" }).textContent).toContain("orchestrator turn ended with an API error");
    cleanup();
    expect(row({ kind: "fail", text: "failed: Backfill dry run (Tool error)" }).textContent).toContain("failed: Backfill dry run (Tool error)");
  });

  it("reads a session end by its reason", () => {
    const cases: [string, string][] = [
      ["clear", "Session ended (cleared)."],
      ["logout", "Session ended (logged out)."],
      ["prompt_input_exit", "Session ended (you exited)."],
      ["resume", "Session ended (switched to another session)."],
      ["other", "Session ended."],
      ["something_new", "Session ended."],
    ];
    for (const [reason, text] of cases) {
      const li = row({ kind: "end", text: `session.end · ${reason}` });
      expect(li.querySelector(".tt")!.textContent).toContain(text);
      expect(li.textContent).not.toContain("session.end");
      cleanup();
    }
  });

  it("reads a session start from settings hooks by its source", () => {
    const cases: [string, string][] = [
      ["startup", "Session started."],
      ["resume", "Session resumed."],
      ["clear", "Session started after clear."],
      ["compact", "Session continued after compaction."],
      ["unknown", "Session started."],
    ];
    for (const [source, text] of cases) {
      const li = row({ kind: "start", text: `session.start (settings hooks) · ${source}` });
      expect(li.querySelector(".tt")!.textContent).toContain(text);
      expect(li.textContent).not.toContain("settings hooks");
      cleanup();
    }
  });

  it("drops the implementation detail from a spawn seen only by settings hooks", () => {
    const li = row({ kind: "spawn", text: "spawned Explore (seen by settings hooks)" });
    expect(li.querySelector(".tt")!.textContent).toContain("Spawned Explore.");
    expect(li.textContent).not.toContain("seen by settings hooks");
    cleanup();
    expect(row({ kind: "spawn", text: "spawned research: Audit retry settings" }).textContent).toContain("spawned research: Audit retry settings");
  });

  it("only rewrites the events it knows", () => {
    expect(readableEvent(makeEvent({ kind: "note", text: "hello" }))).toBeNull();
    expect(readableEvent(makeEvent({ kind: "end", text: "something else" }))).toBeNull();
  });
});
