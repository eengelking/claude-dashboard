// Admin > Spend (#239): today's estimated spend by person or group, paged with Admin's pager. The numbers come from the fleet stream.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminView } from "./AdminView";
import { fmtUsd } from "../format";
import { makeKpis, makeSession, makeState } from "../fixtures";
import type { OwnerSpend } from "../types";
import type { FleetSource } from "../useFleet";

class QuietSource {
  onerror = null;
  readyState = 1;
  addEventListener() {}
  close() {}
}

/** The Admin API stand-in: already unlocked, and every other route is empty. */
function stubAdmin() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://x").pathname.replace("/api/admin", "");
      const body = path === "/session" ? { enabled: true, unlocked: true } : { total: 0, page: 1, pageSize: 50, rows: [], people: [], groups: [], counts: {} };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    }),
  );
}

const owner = (i: number) => `P${String(i).padStart(3, "0")}`;
/** `n` people: P001 spent $1, P002 $2, and so on, in groups G0 to G2; every third one has a live session. */
function fleetOf(n: number, hostile?: string) {
  const spend: OwnerSpend[] = Array.from({ length: n }, (_, i) => ({ owner: i === 0 && hostile ? hostile : owner(i + 1), group: `G${i % 3}`, costUsd: i + 1 }));
  const sessions = spend.filter((_, i) => i % 3 === 0).map((r, i) => makeSession({ id: `s${i}`, owner: r.owner, ownerGroup: r.group }));
  const total = spend.reduce((a, r) => a + r.costUsd, 0);
  return { body: makeState({ sessions, kpis: makeKpis({ costToday: total, costTodayByOwner: spend }) }), total, live: sessions.length };
}

async function openSpend(n: number, hostile?: string) {
  stubAdmin();
  const f = fleetOf(n, hostile);
  const quiet = new QuietSource() as unknown as FleetSource;
  render(<AdminView fleetOptions={{ open: () => quiet, fetchState: async () => f.body }} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Spend/ }));
  const panel = await screen.findByRole("region", { name: "Spend today, by person" });
  await waitFor(() => expect(within(panel).getByRole("status")).toHaveTextContent(/Showing [1-9]/));
  return { ...f, panel };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("EventSource", QuietSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const names = (panel: HTMLElement) => within(panel).getAllByRole("listitem").map((li) => li.getAttribute("aria-label")?.split(":")[0]);

describe("Admin > Spend", () => {
  it("is in the Activity group, above Admin log", async () => {
    stubAdmin();
    const f = fleetOf(3);
    render(<AdminView fleetOptions={{ open: () => new QuietSource() as unknown as FleetSource, fetchState: async () => f.body }} />);
    const group = await screen.findByRole("group", { name: "Activity" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent?.replace(/\d+$/, ""))).toEqual(["Spend", "Admin log"]);
  });

  it("shows 3 people with the total and live sessions, and a pager that reads 1 to 3 of 3", async () => {
    const { panel, total, live } = await openSpend(3);
    expect(names(panel)).toEqual(["P003", "P002", "P001"]);
    expect(within(panel).getByText("live sessions").previousElementSibling).toHaveTextContent(String(live));
    expect(within(panel).getByText(/spent today, all 3 people/).previousElementSibling).toHaveTextContent(fmtUsd(total));
    expect(within(panel).getByRole("status")).toHaveTextContent("Showing 1 to 3 of 3");
    expect(within(panel).getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("pages 64 people 25 at a time, largest first, and the total still counts all 64", async () => {
    const { panel, total } = await openSpend(64);
    expect(names(panel)).toHaveLength(25);
    expect(names(panel)[0]).toBe("P064");
    expect(within(panel).getByText("Page 1 of 3")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Next" }));
    expect(within(panel).getByRole("status")).toHaveTextContent("Showing 26 to 50 of 64");
    expect(names(panel)[0]).toBe("P039");
    expect(within(panel).getByText(/spent today, all 64 people/).previousElementSibling).toHaveTextContent(fmtUsd(total));
    fireEvent.click(within(panel).getByRole("button", { name: "Next" }));
    expect(names(panel)).toHaveLength(14);
    expect(within(panel).getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("changes the rows per page and starts again at page 1", async () => {
    const { panel } = await openSpend(64);
    fireEvent.click(within(panel).getByRole("button", { name: "Next" }));
    fireEvent.change(within(panel).getByLabelText("Rows per page"), { target: { value: "50" } });
    expect(within(panel).getByRole("status")).toHaveTextContent("Showing 1 to 50 of 64");
    expect(within(panel).getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("shows the table with a Total row for everyone, whatever page is showing", async () => {
    const { panel, total, live } = await openSpend(64);
    fireEvent.click(within(panel).getByRole("button", { name: "Table" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Next" }));
    const rows = within(panel).getAllByRole("row").map((r) => [...r.querySelectorAll("th,td")].map((c) => c.textContent));
    expect(rows).toHaveLength(1 + 25 + 1);
    expect(rows[1]![0]).toBe("P039");
    expect(rows[rows.length - 1]).toEqual(expect.arrayContaining(["Total", fmtUsd(total), "100%", String(live)]));
  });

  it("keeps the page when Chart becomes Table, and starts over when the grouping changes", async () => {
    const { panel } = await openSpend(64);
    fireEvent.click(within(panel).getByRole("button", { name: "Next" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Table" }));
    expect(within(panel).getByRole("status")).toHaveTextContent("Showing 26 to 50 of 64");
    fireEvent.click(within(panel).getByRole("button", { name: "Groups" }));
    const byGroup = screen.getByRole("region", { name: "Spend today, by group" });
    expect(within(byGroup).getByRole("status")).toHaveTextContent("Showing 1 to 3 of 3");
  });

  it("groups by group: one row per group, paged and totalled the same way", async () => {
    stubAdmin();
    const f = fleetOf(64);
    render(<AdminView fleetOptions={{ open: () => new QuietSource() as unknown as FleetSource, fetchState: async () => f.body }} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Spend/ }));
    const people = await screen.findByRole("region", { name: "Spend today, by person" });
    fireEvent.click(within(people).getByRole("button", { name: "Groups" }));
    const panel = screen.getByRole("region", { name: "Spend today, by group" });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
    expect(within(panel).getByRole("status")).toHaveTextContent("Showing 1 to 3 of 3");
    expect(within(panel).getByText(/spent today, all 3 groups/).previousElementSibling).toHaveTextContent(fmtUsd(f.total));
  });

  it("remembers the page's own choices in this browser", async () => {
    const { panel } = await openSpend(5);
    fireEvent.click(within(panel).getByRole("button", { name: "Table" }));
    expect(JSON.parse(localStorage.getItem("podium.adminSpend") ?? "{}")).toMatchObject({ view: "table", groupBy: "people" });
    cleanup();
    await openSpend(5);
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
  });

  it("draws a hostile name as text", async () => {
    const { panel } = await openSpend(2, '<img src=x onerror="alert(1)">');
    expect(panel.querySelector("img")).toBeNull();
    expect(within(panel).getAllByText('<img src=x onerror="alert(1)">').length).toBeGreaterThan(0);
  });
});
