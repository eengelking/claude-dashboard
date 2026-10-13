import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FactsBar } from "./FactsBar";
import { makeAgent, makeSession } from "../fixtures";

afterEach(cleanup);

function agentsTile(agents: ReturnType<typeof makeAgent>[]) {
  const { container } = render(<FactsBar s={makeSession({ agents })} now={Date.now()} onAgent={() => {}} />);
  return [...container.querySelectorAll(".fact")].find((f) => f.querySelector(".k")?.textContent === "Agents")!;
}

describe("FactsBar Agents tile (#100)", () => {
  const states: [string, ReturnType<typeof makeAgent>[], string][] = [
    ["no agents", [], "0 running / 0 done"],
    ["running only", [makeAgent({ id: "a", status: "running" }), makeAgent({ id: "b", status: "running" }), makeAgent({ id: "c", status: "running" })], "3 running / 0 done"],
    ["done only", Array.from({ length: 12 }, (_, i) => makeAgent({ id: `d${i}`, status: "done" })), "0 running / 12 done"],
  ];

  it.each(states)("shows %s as one line, counts joined by a slash", (_n, agents, text) => {
    const tile = agentsTile(agents);
    expect(tile.querySelector(".v")!.textContent).toBe(text);
    expect(tile.querySelector(".n-done")).toHaveClass("n-done");
  });

  it("sizes the tile to its content and never wraps its text, so a narrow bar moves the whole tile instead", () => {
    expect(agentsTile([])).toHaveClass("agents");
  });

  it("keeps the failed button on the same line after the counts", () => {
    const v = agentsTile([makeAgent({ id: "a", status: "running" }), makeAgent({ id: "f", status: "failed" })]).querySelector(".v")!;
    expect(v.textContent).toBe("1 running / 0 done1 failed");
    expect(v.querySelector("button.blow")!.textContent).toBe("1 failed");
  });
});
