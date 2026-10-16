// #225: the pill after the logo names the page, and the page supplies its text.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { TopBar } from "./components/TopBar";
import { HistoryView } from "./HistoryView";
import { AdminView } from "./admin/AdminView";
import { makeSession } from "./fixtures";
import { stateFrom } from "./testState";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pageName = (container: HTMLElement) => container.querySelector("header.top > .pill")?.textContent;

describe("the page pill in the top bar", () => {
  it("says Fleet on the wall and Orchestrator on an orchestrator's page, and Fleet again after Back", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [makeSession()] })} />);
    expect(pageName(container)).toBe("Fleet");
    fireEvent.click(container.querySelector(".wall .card")!);
    expect(pageName(container)).toBe("Orchestrator");
    fireEvent.click(screen.getByRole("button", { name: /All orchestrators/ }));
    expect(pageName(container)).toBe("Fleet");
  });

  it("shows the text the page gives it", () => {
    const { container } = render(<TopBar phase="live" reporters={1} page="Somewhere new" />);
    expect(pageName(container)).toBe("Somewhere new");
  });

  it("says History in History and Admin in Admin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    vi.stubGlobal("EventSource", class { onerror = null; readyState = 1; addEventListener() {} close() {} });
    const history = render(<HistoryView initialDay="2026-10-10" />);
    await screen.findByRole("link", { name: "Podium, fleet" });
    expect(pageName(history.container)).toBe("History");
    history.unmount();
    const admin = render(<AdminView />);
    await screen.findByRole("link", { name: "Podium, fleet" });
    expect(pageName(admin.container)).toBe("Admin");
  });
});
