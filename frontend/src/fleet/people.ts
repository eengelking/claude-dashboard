// The people view (issue #34): who each orchestrator belongs to, grouped into bands by person or by
// group. Pure functions; the components only draw what these return. People come from live sessions:
// nothing about a person is kept once their last session leaves the wall.
import type { OwnerSpend, SessionView } from "./types";

/** The owner of a session reported with the admin secret (the server's ADMIN_OWNER). */
export const ADMIN = "Admin";

export type GroupBy = "people" | "group" | "none";
export const GROUP_BYS: Record<GroupBy, string> = { people: "People", group: "Group", none: "None" };

export type UnitOrder = "attention" | "spend" | "name";
export const UNIT_ORDERS: Record<UnitOrder, string> = { attention: "Needs attention", spend: "Spend", name: "Name" };

/** What a band stands for. Admin, Unassigned and No group are kept apart from named people and groups. */
export type UnitKind = "person" | "admin" | "unassigned" | "group" | "nogroup";

export interface Unit {
  /** Stable across renders: `p:<name>`, `admin`, `unassigned`, `g:<group>` or `nogroup`. */
  key: string;
  kind: UnitKind;
  name: string;
  sessions: SessionView[];
  /** Sessions that have not ended. */
  live: number;
  waiting: number;
  stale: number;
  /** Today's estimated spend for everyone in the band, from the server's per-owner split. */
  spend: number;
  /** A person's group; null for every other kind. */
  group: string | null;
  /** A group's people with live sessions, by name. */
  members: string[];
  /** The viewer's own person, or the group the viewer is in. */
  mine: boolean;
}

/** Bands, the Group by control and the spend chart show once any live session belongs to a named person. */
export function peopleActive(sessions: readonly SessionView[]): boolean {
  return sessions.some((s) => isPerson(s.owner));
}

export function isPerson(owner: string | null | undefined): owner is string {
  return !!owner && owner !== ADMIN;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The person band a session goes in. */
export function personKey(owner: string | null): string {
  return owner === null ? "unassigned" : owner === ADMIN ? "admin" : `p:${owner}`;
}

/** The group band a session goes in. Admin and unowned sessions have no group. */
export function groupKey(s: Pick<SessionView, "owner" | "ownerGroup">): string {
  return isPerson(s.owner) && s.ownerGroup ? `g:${s.ownerGroup}` : "nogroup";
}

/** One or two letters for a monogram: the first letter of the first two words (`Ed E.` is `EE`). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ""))[0] ?? "";
  const out = words.slice(0, 2).map(first).join("");
  return (out || Array.from(name.trim())[0] || "?").toUpperCase();
}

/**
 * A label for each session's machine: the host name, plus the start of its id where one person has two
 * different machines with the same host name. Keyed by session id; a session with no machine is absent.
 */
export function machineLabels(sessions: readonly SessionView[]): Map<string, string> {
  const idsByName = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (!s.machine) continue;
    const k = `${s.owner ?? ""}\n${s.machine.name}`;
    const set = idsByName.get(k) ?? new Set<string>();
    set.add(s.machine.id);
    idsByName.set(k, set);
  }
  const out = new Map<string, string>();
  for (const s of sessions) {
    if (!s.machine) continue;
    const clash = (idsByName.get(`${s.owner ?? ""}\n${s.machine.name}`)?.size ?? 0) > 1;
    out.set(s.id, clash ? `${s.machine.name} (${s.machine.id.slice(0, 4)})` : s.machine.name);
  }
  return out;
}

function spendOf(rows: readonly OwnerSpend[], match: (r: OwnerSpend) => boolean): number {
  return rows.reduce((n, r) => (match(r) ? n + r.costUsd : n), 0);
}

const counted = (sessions: SessionView[]) => ({
  live: sessions.filter((s) => s.status !== "done").length,
  waiting: sessions.filter((s) => s.status === "waiting").length,
  stale: sessions.filter((s) => s.status === "stale").length,
});

/**
 * The bands for a Group by choice, from the live sessions, each with its counts and today's spend.
 * Empty groups never appear: a band exists only for sessions that are live now. `none` has no bands.
 */
export function buildUnits(sessions: readonly SessionView[], by: GroupBy, spend: readonly OwnerSpend[], me: string | null): Unit[] {
  if (by === "none") return [];
  const myGroup = me ? sessions.find((s) => same(s.owner, me))?.ownerGroup ?? spend.find((r) => same(r.owner, me))?.group ?? null : null;
  const buckets = new Map<string, SessionView[]>();
  for (const s of sessions) {
    const k = by === "people" ? personKey(s.owner) : groupKey(s);
    const list = buckets.get(k) ?? [];
    list.push(s);
    buckets.set(k, list);
  }
  const units: Unit[] = [];
  for (const [key, list] of buckets) {
    const first = list[0]!;
    if (by === "people") {
      const kind: UnitKind = key === "admin" ? "admin" : key === "unassigned" ? "unassigned" : "person";
      const owner = kind === "person" ? first.owner! : kind === "admin" ? ADMIN : null;
      units.push({
        key,
        kind,
        name: kind === "unassigned" ? "Unassigned" : owner!,
        sessions: list,
        ...counted(list),
        spend: spendOf(spend, (r) => r.owner === owner),
        group: kind === "person" ? list.find((s) => s.ownerGroup)?.ownerGroup ?? null : null,
        members: [],
        mine: kind === "person" && same(owner, me),
      });
    } else {
      const group = key === "nogroup" ? null : first.ownerGroup!;
      const members = [...new Set(list.map((s) => s.owner).filter(isPerson))].sort((a, b) => a.localeCompare(b));
      units.push({
        key,
        kind: group === null ? "nogroup" : "group",
        name: group ?? "No group",
        sessions: list,
        ...counted(list),
        spend: spendOf(spend, (r) => (group === null ? !isPerson(r.owner) || !r.group : isPerson(r.owner) && r.group === group)),
        group: null,
        members,
        mine: group === null ? !!me && !myGroup && members.some((m) => same(m, me)) : same(group, myGroup),
      });
    }
  }
  return units;
}

const SPECIAL_LAST: Record<UnitKind, number> = { person: 0, group: 0, admin: 1, nogroup: 1, unassigned: 2 };

/**
 * Bands in order. Admin, No group and Unassigned always come last. "Needs attention" puts the viewer's
 * own band first, then the most sessions waiting or stale, then the most spend; "Spend" is most spend
 * first; "Name" is alphabetical. Ties fall back to the name, so the order never jumps between renders.
 */
export function orderUnits(units: readonly Unit[], order: UnitOrder): Unit[] {
  const byName = (a: Unit, b: Unit) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.key < b.key ? -1 : 1);
  const cmp: Record<UnitOrder, (a: Unit, b: Unit) => number> = {
    attention: (a, b) => Number(b.mine) - Number(a.mine) || b.waiting + b.stale - (a.waiting + a.stale) || b.spend - a.spend,
    spend: (a, b) => b.spend - a.spend,
    name: () => 0,
  };
  return units.slice().sort((a, b) => SPECIAL_LAST[a.kind] - SPECIAL_LAST[b.kind] || cmp[order](a, b) || byName(a, b));
}

/** Who the wall is narrowed to: a band picked in the left list, or "Only me". */
export interface PeopleFilter {
  /** A person band key (`p:<name>`, `admin`, `unassigned`). */
  person: string | null;
  /** A group band key (`g:<group>`, `nogroup`). */
  group: string | null;
}
export const NO_FILTER: PeopleFilter = { person: null, group: null };

export function filterByPeople(sessions: readonly SessionView[], f: PeopleFilter): SessionView[] {
  return sessions.filter((s) => (!f.person || personKey(s.owner) === f.person) && (!f.group || groupKey(s) === f.group));
}

/** The names people report under, for the "You are" picker: every live person, plus the stored choice. */
export function peopleNames(sessions: readonly SessionView[], me: string | null): string[] {
  const names = new Map<string, string>();
  for (const s of sessions) if (isPerson(s.owner)) names.set(s.owner.toLowerCase(), s.owner);
  if (me && !names.has(me.toLowerCase())) names.set(me.toLowerCase(), me);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** The viewer's band key, for "Only me". */
export function meKey(sessions: readonly SessionView[], me: string | null): string | null {
  if (!me) return null;
  const s = sessions.find((x) => same(x.owner, me));
  return personKey(s?.owner ?? me);
}

export interface SpendRow {
  key: string;
  kind: UnitKind;
  name: string;
  spend: number;
  /** Live orchestrators in that person or group now. */
  sessions: number;
}

/**
 * Today's estimated spend per person or per group, largest first, for the chart and its table. A person
 * whose sessions all ended today still has a row (the money was spent), but no band on the wall.
 */
export function spendRows(spend: readonly OwnerSpend[], sessions: readonly SessionView[], by: GroupBy): SpendRow[] {
  const perGroup = by === "group";
  const rows = new Map<string, SpendRow>();
  const keyOf = (owner: string | null, group: string | null) => (perGroup ? groupKey({ owner, ownerGroup: group }) : personKey(owner));
  const row = (owner: string | null, group: string | null): SpendRow => {
    const key = keyOf(owner, group);
    let r = rows.get(key);
    if (!r) {
      const kind: UnitKind = perGroup ? (key === "nogroup" ? "nogroup" : "group") : key === "admin" ? "admin" : key === "unassigned" ? "unassigned" : "person";
      const name = perGroup ? (key === "nogroup" ? "No group" : group!) : key === "unassigned" ? "Unassigned" : owner!;
      r = { key, kind, name, spend: 0, sessions: 0 };
      rows.set(key, r);
    }
    return r;
  };
  for (const r of spend) row(r.owner, r.group).spend += r.costUsd;
  for (const s of sessions) row(s.owner, s.ownerGroup).sessions++;
  return [...rows.values()]
    .filter((r) => r.spend > 0 || r.sessions > 0)
    .sort((a, b) => b.spend - a.spend || SPECIAL_LAST[a.kind] - SPECIAL_LAST[b.kind] || a.name.localeCompare(b.name));
}

/** A share of a total as a whole percentage; 0 when there is no total. */
export function sharePct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
