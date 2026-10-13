import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FactsBar } from "./FactsBar";
import { makeAgent, makeSession } from "../fixtures";

afterEach(cleanup);

function agentsTile(agents: ReturnType<typeof makeAgent>[]) {
  const { container } = render(<FactsBar s={makeSession({ agents })} now={Date.now()} onAgent={() => {}} />);
  const tile = [...container.querySelectorAll(".fact")].find((f) => f.querySelector(".k")?.textContent === "Agents")!;
  return tile.querySelector(".v")!;
}

describe("FactsBar Agents tile (#100)", () => {
  const states: [string, ReturnType<typeof makeAgent>[], string, string][] = [
    ["no agents", [], "0 running", "0 done"],
    ["running only", [makeAgent({ id: "a", status: "running" }), makeAgent({ id: "b", status: "running" }), makeAgent({ id: "c", status: "running" })], "3 running", "0 done"],
    ["done only", Array.from({ length: 12 }, (_, i) => makeAgent({ id: `d${i}`, status: "done" })), "0 running", "12 done"],
  ];

  it.each(states)("shows %s as two counts with no separator that could start a line", (_n, agents, running, done) => {
    const v = agentsTile(agents);
    expect(v.querySelector(".n-running")!.textContent).toBe(running);
    expect(v.querySelector(".n-done")!.textContent).toBe(done);
    expect(v.textContent).not.toContain("·");
  });

  it("keeps the failed button beside the running count and draws no separator before it", () => {
    const v = agentsTile([makeAgent({ id: "a", status: "running" }), makeAgent({ id: "f", status: "failed" })]);
    expect(v.querySelector("button.blow")!.textContent).toBe("1 failed");
    expect(v.textContent).not.toContain("·");
  });
});
