import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { FocusView } from "./components/FocusView";
import { makeAgent, makeSession } from "./fixtures";
import { stateFrom } from "./testState";

afterEach(cleanup);

const CFG = { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000, detachedHideAfterMs: 60_000 };

const delegating = () => makeSession({ status: "running", agents: [makeAgent({ id: "a1", description: "Map call sites" })] });
const finished = () => makeSession({ status: "running", agents: [makeAgent({ id: "a1", status: "done", endedAt: 1_000_500 })] });

// #287: the card, the rail item and the wall show the same delegating state as the orchestrator page.
describe("delegating on the fleet card, the rail and the wall (#287)", () => {
  it("the wall card says it is delegating and names how many agents, in the delegating style", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [delegating()] })} />);
    const band = container.querySelector(".wall .card .band")!;
    expect(band.className).toContain("deleg");
    expect(band.textContent).toContain("Delegating to 1 agent.");
    expect(band.textContent).not.toContain("Running");
    expect(band.getAttribute("title") ?? band.querySelector("[title]")?.getAttribute("title")).toContain("Map call sites");
    expect(container.querySelector(".wall .card .sd .si-deleg")).not.toBeNull();
  });

  it("the rail item shows the delegating ring dot and says delegating", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [delegating()] })} />);
    const item = [...container.querySelectorAll(".rail .ritem")].find((e) => e.textContent?.includes("api-refactor"))!;
    expect(item.querySelector("i.dot.ring")).not.toBeNull();
    expect(item.querySelector("i.dot.running")).toBeNull();
    expect(item.textContent).toContain("delegating");
  });

  it("returns to Running when the child finishes", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [finished()] })} />);
    const band = container.querySelector(".wall .card .band")!;
    expect(band.className).toContain("running");
    expect(band.textContent).toContain("Running");
    expect(container.querySelector(".rail .ritem i.dot.running")).not.toBeNull();
  });

  it("with no agents at all it is still Running", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [makeSession({ status: "running", agents: [] })] })} />);
    expect(container.querySelector(".wall .card .band")!.className).toContain("running");
  });

  it("a session waiting on the person keeps its own state while an agent runs", () => {
    const s = makeSession({ status: "waiting", waitReason: "input", agents: [makeAgent()] });
    const { container } = render(<FleetView state={stateFrom({ sessions: [s] })} />);
    expect(container.querySelector(".wall .card .band")!.className).toContain("waiting");
  });

  it("still counts as running in the status filter", () => {
    render(<FleetView state={stateFrom({ sessions: [delegating()] })} />);
    expect(screen.getByRole("button", { name: "Running" })).toBeInTheDocument();
  });

  it("the card and the orchestrator page agree", () => {
    const s = delegating();
    const card = render(<FleetView state={stateFrom({ sessions: [s] })} />);
    const cardText = card.container.querySelector(".wall .card .band .bl")!.textContent;
    cleanup();
    const page = render(<FocusView s={s} now={Date.now()} config={CFG} sort={{ key: null, dir: "asc" } as never} onSort={() => {}} selectedAgent={null} flashAgent={null} onAgent={() => {}} />);
    expect(page.container.querySelector(".op .band .bl")!.textContent).toBe(cardText);
    expect(page.container.querySelector(".op .band")!.className).toContain("deleg");
  });
});
