import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TopBar } from "./components/TopBar";
import { HistoryView } from "./HistoryView";
import { AdminView } from "./admin/AdminView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function quietServer() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
}

describe("logo link", () => {
  it("takes the wall's logo to the fleet page", () => {
    render(<TopBar phase="live" reporters={1} />);
    const link = screen.getByRole("link", { name: "Podium, fleet" });
    expect(link).toHaveAttribute("href", "#/");
    expect(link).toHaveTextContent("Podium");
  });

  it("takes History's logo to the fleet page", async () => {
    quietServer();
    render(<HistoryView initialDay="2026-10-10" />);
    expect(await screen.findByRole("link", { name: "Podium, fleet" })).toHaveAttribute("href", "#/");
  });

  it("takes Admin's logo to the fleet page", async () => {
    quietServer();
    render(<AdminView />);
    expect(await screen.findByRole("link", { name: "Podium, fleet" })).toHaveAttribute("href", "#/");
  });
});
