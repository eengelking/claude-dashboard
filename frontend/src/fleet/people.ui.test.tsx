import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { makeKpis, makeSession } from "./fixtures";
import { stateFrom } from "./testState";
import type { OwnerSpend, SessionView } from "./types";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const S = (id: string, owner: string | null, over: Partial<SessionView> = {}) => makeSession({ id, name: `${id}-proj`, owner, ...over });
const fleet: SessionView[] = [
  S("ed1", "Ed E.", { ownerGroup: "Frontend", machine: { name: "eds-mbp", id: "aaaa0001" } }),
  S("ed2", "Ed E.", { ownerGroup: "Frontend", machine: { name: "build-01", id: "bbbb0002" }, status: "waiting" }),
  S("pr1", "Priya N.", { ownerGroup: "Backend", machine: { name: "priya-mbp", id: "cccc0003" }, status: "stale" }),
  S("da1", "Dana K.", { ownerGroup: null, machine: { name: "dana-mbp", id: "dddd0004" } }),
  S("ad1", "Admin"),
  S("un1", null),
];
const spend: OwnerSpend[] = [
  { owner: "Priya N.", group: "Backend", costUsd: 8 },
  { owner: "Ed E.", group: "Frontend", costUsd: 6 },
  { owner: "Dana K.", group: null, costUsd: 4 },
  { owner: "Admin", group: null, costUsd: 1 },
  { owner: null, group: null, costUsd: 1 },
];
const view = (sessions = fleet) => render(<FleetView state={stateFrom({ sessions, kpis: makeKpis({ costToday: 20, costTodayByOwner: spend }) })} />);
const bands = (c: HTMLElement) => [...c.querySelectorAll(".bands > section")].map((b) => b.getAttribute("aria-label"));
const band = (name: string) => screen.getByRole("region", { name });
const rail = () => screen.getByRole("navigation", { name: "Orchestrators" });

describe("people view", () => {
  it("stays the plain wall while no session reports a person, even with Admin and unowned sessions", () => {
    const { container } = view([S("ad1", "Admin"), S("un1", null)]);
    expect(screen.queryByRole("group", { name: "Group by" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Only me" })).toBeNull();
    expect(screen.queryByText("Spend today, by person")).toBeNull();
    expect(container.querySelector(".bands")).toBeNull();
    expect(container.querySelectorAll(".wall .card")).toHaveLength(2);
    expect(container.querySelector(".card .owner")).toBeNull();
  });

  it("shows a band per person with counts, attention and share of today's spend, then Admin and Unassigned", () => {
    const { container } = view();
    expect(bands(container)).toEqual(["Priya N.", "Ed E.", "Dana K.", "Admin", "Unassigned"]);
    const ed = band("Ed E.");
    expect(within(ed).getByText("2 live")).toBeInTheDocument();
    expect(within(ed).getByText("1 waiting")).toBeInTheDocument();
    expect(within(ed).getByText("$6.00")).toBeInTheDocument();
    expect(within(ed).getByText("30%")).toBeInTheDocument();
    expect(within(ed).getByText("Frontend")).toBeInTheDocument();
    expect(within(band("Priya N.")).getByText("1 stale")).toBeInTheDocument();
    // One band for one person on two machines; each card says which machine it runs on.
    expect(within(ed).getByText("eds-mbp, build-01")).toBeInTheDocument();
    expect(within(ed).getAllByRole("button").filter((b) => b.classList.contains("card"))).toHaveLength(2);
    expect([...ed.querySelectorAll(".card .mach")].map((e) => e.textContent)).toEqual(["on eds-mbp", "on build-01"]);
    expect(ed.querySelector(".card .owner .nm")).toBeNull();
  });

  it("collapses a band to its header and remembers it", () => {
    view();
    const head = within(band("Ed E.")).getAllByRole("button", { expanded: true })[0]!;
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(within(band("Ed E.")).getByText("2 hidden")).toBeInTheDocument();
    expect(document.getElementById(head.getAttribute("aria-controls")!)).not.toBeVisible();
    cleanup();
    view();
    expect(within(band("Ed E.")).getAllByRole("button", { expanded: false })).toHaveLength(1);
  });

  it("groups by group: a band per group naming each card's owner, No group last, and no band for a group with nobody live", () => {
    const { container } = view();
    fireEvent.click(within(screen.getByRole("group", { name: "Group by" })).getByRole("button", { name: "Group" }));
    expect(bands(container)).toEqual(["Backend", "Frontend", "No group"]);
    const ng = band("No group");
    expect([...ng.querySelectorAll(".card .owner .nm")].map((e) => e.textContent).sort()).toEqual(["Admin", "Dana K.", "Unassigned"]);
    expect(within(band("Frontend")).getByText("Ed E.", { selector: ".h" })).toBeInTheDocument();
    expect(screen.getByText("Spend today, by group")).toBeInTheDocument();
  });

  it("group by None is the flat wall with each card's owner", () => {
    const { container } = view();
    fireEvent.click(within(screen.getByRole("group", { name: "Group by" })).getByRole("button", { name: "None" }));
    expect(container.querySelector(".bands")).toBeNull();
    expect(screen.queryByRole("group", { name: "Order by" })).toBeNull();
    expect(container.querySelectorAll(".wall .card .owner .nm")).toHaveLength(6);
  });

  it("orders bands by spend or by name", () => {
    const { container } = view();
    const order = within(screen.getByRole("group", { name: "Order by" }));
    fireEvent.click(order.getByRole("button", { name: "Name" }));
    expect(bands(container)).toEqual(["Dana K.", "Ed E.", "Priya N.", "Admin", "Unassigned"]);
    fireEvent.click(order.getByRole("button", { name: "Spend" }));
    expect(bands(container)).toEqual(["Priya N.", "Ed E.", "Dana K.", "Admin", "Unassigned"]);
  });

  it("clicking a person in the left list narrows the wall and the list to them, and Show everyone undoes it", () => {
    const { container } = view();
    fireEvent.click(within(rail()).getByRole("button", { name: /Priya N\./, pressed: false }));
    expect(bands(container)).toEqual(["Priya N."]);
    expect(within(rail()).queryByText("ed1-proj")).toBeNull();
    expect(screen.getByText("Showing Priya N.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everyone" }));
    expect(bands(container)).toHaveLength(5);
  });

  it("knows who the viewer is from this browser: Only me, the you tag, and first place in Needs attention", () => {
    const { container } = view();
    expect(screen.getByRole("button", { name: "Only me" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("You are"), { target: { value: "Dana K." } });
    expect(window.localStorage.getItem("podium.me")).toBe(JSON.stringify("Dana K."));
    expect(bands(container)[0]).toBe("Dana K.");
    expect(within(band("Dana K.")).getByText("you")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Only me" }));
    expect(bands(container)).toEqual(["Dana K."]);
    cleanup();
    view();
    expect(screen.getByLabelText("You are")).toHaveValue("Dana K.");
  });

  it("shows today's spend by person as a chart and as a table with a total", () => {
    view();
    const panel = screen.getByRole("region", { name: "Spend today, by person" });
    const bars = within(panel).getAllByRole("listitem");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Priya N.: $8.00, 40% of $20.00",
      "Ed E.: $6.00, 30% of $20.00",
      "Dana K.: $4.00, 20% of $20.00",
      "Admin: $1.00, 5% of $20.00",
      "Unassigned: $1.00, 5% of $20.00",
    ]);
    fireEvent.click(within(panel).getByRole("button", { name: "Table" }));
    const rows = within(panel).getAllByRole("row").map((r) => [...r.querySelectorAll("th,td")].map((c) => c.textContent));
    expect(rows[1]).toEqual(["Priya N.", "1", "$8.00", "40%"]);
    expect(rows[rows.length - 1]).toEqual(["Total", "6", "$20.00", "100%"]);
  });

  it("draws a hostile name as text", () => {
    const { container } = view([S("x1", '<img src=x onerror="alert(1)">', { machine: { name: "<b>host</b>", id: "abcd" } })]);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText('<img src=x onerror="alert(1)">').length).toBeGreaterThan(0);
    expect(screen.getAllByText("<b>host</b>").length).toBeGreaterThan(0);
  });
});
