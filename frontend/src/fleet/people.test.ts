import { describe, it, expect } from "vitest";
import { makeSession } from "./fixtures";
import {
  buildUnits,
  filterByPeople,
  initials,
  machineLabels,
  meKey,
  NO_FILTER,
  orderUnits,
  peopleActive,
  peopleNames,
  sharePct,
  spendRows,
  type Unit,
} from "./people";
import { parseMe, parsePrefs, DEFAULT_PREFS } from "./usePeoplePrefs";
import type { OwnerSpend, SessionView } from "./types";

const m = (name: string, id: string) => ({ name, id });
const S = (id: string, owner: string | null, over: Partial<SessionView> = {}) => makeSession({ id, name: id, owner, ...over });

const sessions: SessionView[] = [
  S("ed1", "Ed E.", { ownerGroup: "Frontend", machine: m("eds-mbp", "aaaa0001"), status: "running" }),
  S("ed2", "Ed E.", { ownerGroup: "Frontend", machine: m("build-01", "bbbb0002"), status: "waiting" }),
  S("pr1", "Priya N.", { ownerGroup: "Backend", machine: m("priya-mbp", "cccc0003"), status: "stale" }),
  S("pr2", "Priya N.", { ownerGroup: "Backend", machine: m("priya-mbp", "cccc0003"), status: "waiting" }),
  S("da1", "Dana K.", { ownerGroup: "Backend", machine: m("dana-mbp", "dddd0004") }),
  S("ma1", "Marcus T.", { ownerGroup: null, machine: m("build-01", "eeee0005"), status: "done" }),
  S("ad1", "Admin"),
  S("un1", null),
];
const spend: OwnerSpend[] = [
  { owner: "Marcus T.", group: null, costUsd: 12 },
  { owner: "Priya N.", group: "Backend", costUsd: 8 },
  { owner: "Ed E.", group: "Frontend", costUsd: 6 },
  { owner: "Dana K.", group: "Backend", costUsd: 3 },
  { owner: "Admin", group: null, costUsd: 0.5 },
  { owner: null, group: null, costUsd: 0.25 },
  { owner: "Gone G.", group: "Data", costUsd: 2 },
];
const keys = (u: Unit[]) => u.map((x) => x.key);

describe("people view logic", () => {
  it("switches on only once a live session belongs to a named person", () => {
    expect(peopleActive([])).toBe(false);
    expect(peopleActive([S("a", null), S("b", "Admin")])).toBe(false);
    expect(peopleActive([S("a", null), S("c", "Dana K.")])).toBe(true);
  });

  it("makes one band per person, plus Admin and Unassigned, with counts and today's spend", () => {
    const units = buildUnits(sessions, "people", spend, null);
    const ed = units.find((u) => u.key === "p:Ed E.")!;
    expect(ed).toMatchObject({ kind: "person", name: "Ed E.", live: 2, waiting: 1, stale: 0, spend: 6, group: "Frontend", mine: false });
    expect(ed.sessions.map((s) => s.id)).toEqual(["ed1", "ed2"]);
    expect(units.find((u) => u.key === "p:Priya N.")).toMatchObject({ waiting: 1, stale: 1, spend: 8 });
    expect(units.find((u) => u.key === "p:Marcus T.")).toMatchObject({ live: 0, spend: 12 });
    expect(units.find((u) => u.key === "admin")).toMatchObject({ kind: "admin", name: "Admin", spend: 0.5 });
    expect(units.find((u) => u.key === "unassigned")).toMatchObject({ kind: "unassigned", name: "Unassigned", spend: 0.25 });
    // A person with spend today but no live session has no band.
    expect(units.some((u) => u.name === "Gone G.")).toBe(false);
  });

  it("one person on two machines is one band", () => {
    const units = buildUnits(sessions, "people", spend, null);
    expect(units.filter((u) => u.name === "Ed E.")).toHaveLength(1);
  });

  it("groups by group, with No group for people without one and for Admin and Unassigned; an empty group has no band", () => {
    const units = buildUnits(sessions, "group", spend, "Dana K.");
    expect(keys(orderUnits(units, "name"))).toEqual(["g:Backend", "g:Frontend", "nogroup"]);
    const be = units.find((u) => u.key === "g:Backend")!;
    expect(be).toMatchObject({ kind: "group", members: ["Dana K.", "Priya N."], spend: 11, mine: true });
    expect(units.find((u) => u.key === "nogroup")).toMatchObject({ kind: "nogroup", name: "No group", members: ["Marcus T."], spend: 12.75, mine: false });
    expect(units.find((u) => u.key === "g:Frontend")!.mine).toBe(false);
  });

  it("marks No group as the viewer's when the viewer has no group", () => {
    const units = buildUnits(sessions, "group", spend, "Marcus T.");
    expect(units.find((u) => u.key === "nogroup")!.mine).toBe(true);
  });

  it("has no bands for None", () => {
    expect(buildUnits(sessions, "none", spend, null)).toEqual([]);
  });

  it("orders by attention with the viewer first, by spend, or by name, and keeps Admin and Unassigned last", () => {
    const units = buildUnits(sessions, "people", spend, null);
    expect(keys(orderUnits(units, "attention"))).toEqual(["p:Priya N.", "p:Ed E.", "p:Marcus T.", "p:Dana K.", "admin", "unassigned"]);
    const mine = buildUnits(sessions, "people", spend, "dana k.");
    expect(keys(orderUnits(mine, "attention"))[0]).toBe("p:Dana K.");
    expect(keys(orderUnits(units, "spend"))).toEqual(["p:Marcus T.", "p:Priya N.", "p:Ed E.", "p:Dana K.", "admin", "unassigned"]);
    expect(keys(orderUnits(units, "name"))).toEqual(["p:Dana K.", "p:Ed E.", "p:Marcus T.", "p:Priya N.", "admin", "unassigned"]);
  });

  it("filters by a person, by a group, or not at all", () => {
    const ids = (l: SessionView[]) => l.map((s) => s.id);
    expect(ids(filterByPeople(sessions, NO_FILTER))).toHaveLength(sessions.length);
    expect(ids(filterByPeople(sessions, { person: "p:Priya N.", group: null }))).toEqual(["pr1", "pr2"]);
    expect(ids(filterByPeople(sessions, { person: "admin", group: null }))).toEqual(["ad1"]);
    expect(ids(filterByPeople(sessions, { person: null, group: "g:Backend" }))).toEqual(["pr1", "pr2", "da1"]);
    expect(ids(filterByPeople(sessions, { person: null, group: "nogroup" }))).toEqual(["ma1", "ad1", "un1"]);
  });

  it("knows the viewer's band key, and lists the names to pick from", () => {
    expect(meKey(sessions, "ed e.")).toBe("p:Ed E.");
    expect(meKey(sessions, "Someone")).toBe("p:Someone");
    expect(meKey(sessions, null)).toBeNull();
    expect(peopleNames(sessions, null)).toEqual(["Dana K.", "Ed E.", "Marcus T.", "Priya N."]);
    expect(peopleNames(sessions, "Zed")).toContain("Zed");
  });

  it("labels machines by host name, adding the id where one person has two machines of one name", () => {
    const l = machineLabels([
      ...sessions,
      S("ed3", "Ed E.", { machine: m("eds-mbp", "ffff0006") }),
    ]);
    expect(l.get("ed1")).toBe("eds-mbp (aaaa)");
    expect(l.get("ed3")).toBe("eds-mbp (ffff)");
    expect(l.get("ed2")).toBe("build-01");
    // Two people on machines of the same name are told apart by the band, not the label.
    expect(l.get("ma1")).toBe("build-01");
    expect(l.has("ad1")).toBe(false);
  });

  it("totals today's spend per person or per group, with live counts, largest first", () => {
    const people = spendRows(spend, sessions, "people");
    expect(people.map((r) => [r.name, r.spend, r.sessions])).toEqual([
      ["Marcus T.", 12, 1],
      ["Priya N.", 8, 2],
      ["Ed E.", 6, 2],
      ["Dana K.", 3, 1],
      ["Gone G.", 2, 0],
      ["Admin", 0.5, 1],
      ["Unassigned", 0.25, 1],
    ]);
    expect(people.reduce((n, r) => n + r.spend, 0)).toBeCloseTo(31.75);
    expect(people.find((r) => r.name === "Priya N.")?.group).toBe("Backend");
    expect(spendRows(spend, sessions, "group").every((r) => r.group === null)).toBe(true);
    const groups = spendRows(spend, sessions, "group");
    expect(groups.map((r) => [r.name, r.spend, r.sessions])).toEqual([
      ["No group", 12.75, 3],
      ["Backend", 11, 3],
      ["Frontend", 6, 2],
      ["Data", 2, 0],
    ]);
  });

  it("makes monograms and shares", () => {
    expect(initials("Ed Engelking")).toBe("EE");
    expect(initials("priya")).toBe("P");
    expect(initials("Marcus T. Jones")).toBe("MT");
    expect(initials("  ")).toBe("?");
    expect(initials("Élodie (ops)")).toBe("ÉO");
    expect(sharePct(1, 3)).toBe(33);
    expect(sharePct(1, 0)).toBe(0);
  });

  it("reads stored choices defensively", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ groupBy: "group", order: "spend", spendView: "table", collapsed: ["people:admin", 4] })).toEqual({ groupBy: "group", order: "spend", collapsed: ["people:admin"] });
    expect(parsePrefs({ groupBy: "teams", order: "random", spendView: "pie", collapsed: "x" })).toEqual(DEFAULT_PREFS);
    // Inherited Object properties are not valid choices.
    expect(parsePrefs({ groupBy: "constructor", order: "toString" })).toEqual(DEFAULT_PREFS);
    expect(parseMe("  Ed E.  ")).toBe("Ed E.");
    expect(parseMe("")).toBeNull();
    expect(parseMe(5)).toBeNull();
  });
});
