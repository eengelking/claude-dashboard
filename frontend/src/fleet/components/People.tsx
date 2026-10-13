// The people view's pieces (issue #34): monograms, the Group by bar, a band per person or group, and the
// owner line on a card. A person is a monogram and a name, never a color: color already means model and
// status here. The look follows mockup/podium-people.html.
import type { ReactNode } from "react";
import { fmtUsd } from "../format";
import { GROUP_BYS, initials, sharePct, UNIT_ORDERS, type GroupBy, type Unit, type UnitKind, type UnitOrder } from "../people";

const GROUPISH: readonly UnitKind[] = ["group", "nogroup"];

/** A round monogram for a person (Admin and Unassigned too), a rounded tile for a group. Decorative: the name is always beside it. */
export function Monogram({ name, kind = "person", size }: { name: string; kind?: UnitKind; size?: "sm" | "lg" }) {
  const cls = `${GROUPISH.includes(kind) ? "gtile" : "mono-g"}${size ? ` ${size}` : ""}${kind === "admin" || kind === "unassigned" || kind === "nogroup" ? " special" : ""}`;
  return (
    <span className={cls} aria-hidden="true">
      {kind === "unassigned" || kind === "nogroup" ? "–" : initials(name)}
    </span>
  );
}

/** The marker on the viewer's own band: "you", or "your group". */
export function YouTag({ kind }: { kind: UnitKind }) {
  return <span className="you">{GROUPISH.includes(kind) ? "your group" : "you"}</span>;
}

function Seg<T extends string>(props: { label: string; options: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <span className="tg">
      <span aria-hidden="true">{props.label}</span>
      <span className="seg" role="group" aria-label={props.label}>
        {(Object.keys(props.options) as T[]).map((k) => (
          <button type="button" key={k} aria-pressed={props.value === k} onClick={() => props.onChange(k)}>
            {props.options[k]}
          </button>
        ))}
      </span>
    </span>
  );
}

/** The row above the wall's toolbar: Group by, Order by, who the viewer is, Only me, and the active people filter. */
export function PeopleBar(props: {
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  order: UnitOrder;
  onOrder: (o: UnitOrder) => void;
  me: string | null;
  names: string[];
  onMe: (name: string | null) => void;
  onlyMe: boolean;
  onOnlyMe: () => void;
  /** "Showing Ed E." while the wall is narrowed to a person or group; null otherwise. */
  filterLabel: string | null;
  onClearFilter: () => void;
}) {
  return (
    <div className="tools people-tools">
      <Seg label="Group by" options={GROUP_BYS} value={props.groupBy} onChange={props.onGroupBy} />
      {props.groupBy !== "none" && <Seg label="Order by" options={UNIT_ORDERS} value={props.order} onChange={props.onOrder} />}
      <span className="tg">
        <label htmlFor="podium-me">You are</label>
        <select className="sel" id="podium-me" value={props.me ?? ""} onChange={(e) => props.onMe(e.target.value || null)}>
          <option value="">Not set</option>
          {props.names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </span>
      <button
        type="button"
        className="chipbtn"
        aria-pressed={props.onlyMe}
        onClick={props.onOnlyMe}
        disabled={!props.me}
        title={props.me ? `Show only ${props.me}'s orchestrators` : "Pick who you are first"}
      >
        Only me
      </button>
      {props.filterLabel && (
        <span className="tg" role="status">
          <span>Showing {props.filterLabel}</span>
          <button type="button" className="chipbtn on" onClick={props.onClearFilter}>
            Show everyone
          </button>
        </span>
      )}
    </div>
  );
}

/** One band: a header that collapses it, and the cards. */
export function Band(props: { unit: Unit; total: number; machines: string[]; open: boolean; onToggle: () => void; shown: number; children: ReactNode }) {
  const u = props.unit;
  const share = sharePct(u.spend, props.total);
  const bodyId = `band-${u.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const sub =
    u.kind === "person" ? props.machines.join(", ")
    : u.kind === "admin" ? "Reports with the admin secret. Give it a person's token in Admin."
    : u.kind === "unassigned" ? "Reports with no token while the server has none."
    : u.kind === "nogroup" ? "People with no group yet, Admin and Unassigned. Assign a group in Admin."
    : u.members.join(", ");
  const attn = [u.waiting ? `${u.waiting} waiting` : "", u.stale ? `${u.stale} stale` : ""].filter(Boolean).join(", ");
  return (
    <section className={`band${props.open ? "" : " shut"}`} aria-label={u.name}>
      <button type="button" className="bh" aria-expanded={props.open} aria-controls={bodyId} onClick={props.onToggle}>
        <svg className="chev" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
        <span className="who">
          <Monogram name={u.name} kind={u.kind} size="lg" />
          <b>{u.name}</b>
          {u.mine && <YouTag kind={u.kind} />}
          {u.kind === "person" && u.group && <span className="chip">{u.group}</span>}
          {sub && (
            <span className="h" title={sub}>
              {sub}
            </span>
          )}
        </span>
        <span className="counts">
          <span>{u.live} live</span>
          {attn && (
            <span className="attn">
              <i className={`dot ${u.waiting ? "waiting" : "stale"}`} aria-hidden="true" />
              {attn}
            </span>
          )}
          {!props.open && <span className="sum">{props.shown} hidden</span>}
        </span>
        <span className="spend" title={`${u.name} is ${share}% of today's estimated spend (${fmtUsd(u.spend)} of ${fmtUsd(props.total)})`}>
          <span className="lab">Share of today's spend</span>
          <span className="v mono">
            {fmtUsd(u.spend)} <span className="pct">{share}%</span>
          </span>
          <span className="share" aria-hidden="true">
            <i style={{ width: `${Math.min(100, share)}%` }} />
          </span>
        </span>
      </button>
      <div className="bgrid wall" id={bodyId} hidden={!props.open}>
        {props.children}
      </div>
    </section>
  );
}

/** The line a card carries in the people view: whose it is (unless the band already says) and which machine. */
export function OwnerLine({ owner, machine, showName }: { owner: string | null; machine: string | null; showName: boolean }) {
  const name = owner ?? "Unassigned";
  if (!showName && !machine) return null;
  return (
    <div className="owner">
      {showName && (
        <>
          <Monogram name={name} kind={owner === null ? "unassigned" : owner === "Admin" ? "admin" : "person"} size="sm" />
          <span className="nm">{name}</span>
        </>
      )}
      {machine && (
        <span className="mach mono" title={`Runs on ${machine}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="3" width="11" height="7.5" rx="1" />
            <path d="M6 13h4M8 10.5V13" />
          </svg>
          <span className="vh">on </span>
          {machine}
        </span>
      )}
    </div>
  );
}
