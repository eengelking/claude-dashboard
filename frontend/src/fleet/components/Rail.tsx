import { planProgress, sessionCounts } from "../logic";
import type { SessionView } from "../types";
import { backgroundOf, BlowBadge, ModelChip, PlanBar, sessionDot, stateKind } from "./Chips";
import { backgroundStatus } from "../waiting";
import { COPYRIGHT, LICENSE_URL, NOTICES_URL } from "../types";
import { PaneTab } from "./PaneTab";
import { Monogram, YouTag } from "./People";
import { ADMIN, isFlat, type GroupBy, type Unit } from "../people";

/** The people view in the left list: the same grouping as the wall, and a band header that narrows the wall to it. */
export interface RailPeople {
  groupBy: GroupBy;
  units: Unit[];
  /** The band key the wall is narrowed to, if any. */
  picked: string | null;
  onPick: (u: Unit) => void;
  /** The sessions the people filter lets through. */
  visible: ReadonlySet<string>;
}

export interface Split {
  running: number;
  waiting: number;
  stale: number;
}

export function splitText(s: Split): string {
  return `${s.running} running · ${s.waiting} waiting · ${s.stale} stale`;
}

export function Rail(props: {
  sessions: SessionView[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  split: Split;
  entering: (id: string) => boolean;
  leaving: Record<string, number>;
  liveCount: number;
  onRemove?: (id: string) => void;
  /** The running server's version; null until the first snapshot. */
  version?: string | null;
  collapsed?: boolean;
  onToggle?: () => void;
  people?: RailPeople;
}) {
  const pv = props.people;
  const item = (s: SessionView, showOwner: boolean) => {
    const p = planProgress(s.plan);
    const c = sessionCounts(s);
    const cls = `ritem${props.entering(s.id) ? " enter" : ""}${props.leaving[s.id] ? " leave" : ""}${s.blowouts.level === 2 ? " risk" : ""}`;
    const removable = s.status === "stale" && !!props.onRemove;
    const owner = s.owner ?? "Unassigned";
    const kind = stateKind(s);
    return (
      <div key={s.id} className={`ritem-slot${removable ? " has-remove" : ""}`}>
        <button type="button" className={cls} aria-current={props.selected === s.id} onClick={() => props.onSelect(s.id)} disabled={!!props.leaving[s.id]}>
          <div className="l1">
            <i className={sessionDot(s, kind)} aria-hidden="true" />
            <span className="nm">{s.name}</span>
            <span className="vh">{backgroundOf(s) ? backgroundStatus(s.background!) : kind === "deleg" ? "delegating" : s.status}</span>
            {showOwner && (
              <span title={owner}>
                <Monogram name={owner} kind={s.owner === null ? "unassigned" : s.owner === ADMIN ? "admin" : "person"} size="sm" />
                <span className="vh">, {owner}</span>
              </span>
            )}
            <BlowBadge n={s.blowouts.total} level={s.blowouts.level} />
            <ModelChip family={s.modelFamily} model={s.model} />
          </div>
          <div className="l2">
            {p ? (
              <>
                <PlanBar pct={p.pct} />
                <span className="mono">
                  {p.done}/{p.total}
                </span>
              </>
            ) : (
              <>
                <span style={{ color: "var(--muted)" }}>no plan reported</span>
                <span style={{ flex: 1 }} />
              </>
            )}
            <span className="mono" title="running / total agents">
              {c.running}/{c.all}
            </span>
          </div>
        </button>
        {removable && (
          <button type="button" className="rx" onClick={() => props.onRemove?.(s.id)} disabled={!!props.leaving[s.id]} title="Remove from the fleet now" aria-label={`Remove ${s.name} from the fleet`}>
            &times;
          </button>
        )}
      </div>
    );
  };
  return (
    <nav className={`rail${props.collapsed ? " collapsed" : ""}`} aria-label="Orchestrators">
      {props.onToggle && <PaneTab side="left" collapsed={!!props.collapsed} controls="podium-rail-body" onToggle={props.onToggle} shortcut="[" />}
      <div id="podium-rail-body" hidden={props.collapsed}>
      <div className="rail-head">
        <h2>Orchestrators</h2>
        <span className="mono" style={{ color: "var(--muted)" }}>
          {props.liveCount}
        </span>
      </div>
      <button type="button" className="ritem" aria-current={props.selected === null} onClick={() => props.onSelect(null)}>
        <div className="l1">
          <span className="nm">All orchestrators</span>
        </div>
        <div className="l2">
          <span>{splitText(props.split)}</span>
        </div>
      </button>
      {pv && !isFlat(pv.groupBy) ? (
        <RailBands sessions={props.sessions} people={pv} item={item} />
      ) : (
        props.sessions.filter((s) => !pv || pv.visible.has(s.id)).map((s) => item(s, !!pv))
      )}
      <footer className="rail-foot">
        <span>
          <a href={NOTICES_URL} target="_blank" rel="noreferrer">
            Theme credits
          </a>
          {" · "}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">
            License
          </a>
        </span>
        <span>
          {props.version && props.version !== "unknown" ? `Podium v${props.version} · ` : ""}
          {COPYRIGHT}
        </span>
      </footer>
      </div>
    </nav>
  );
}

function RailBands({ sessions, people, item }: { sessions: SessionView[]; people: RailPeople; item: (s: SessionView, showOwner: boolean) => JSX.Element }) {
  const unitOf = new Map<string, string>();
  for (const u of people.units) for (const s of u.sessions) unitOf.set(s.id, u.key);
  return (
    <>
      {people.units.map((u) => {
        const rows = sessions.filter((s) => unitOf.get(s.id) === u.key && people.visible.has(s.id));
        if (!rows.length) return null;
        const attn = u.waiting + u.stale;
        const groupish = u.kind === "group" || u.kind === "nogroup";
        return (
          <div className="rgroup" key={u.key}>
            <button type="button" className="rgh" aria-pressed={people.picked === u.key} onClick={() => people.onPick(u)} title={people.picked === u.key ? "Show everyone" : `Show only ${u.name}`}>
              <Monogram name={u.name} kind={u.kind} />
              <span className="nm">
                {u.name}
                {u.mine && (
                  <>
                    {" "}
                    <YouTag kind={u.kind} />
                  </>
                )}
              </span>
              {attn > 0 && (
                <span className="attn" title={`${u.waiting} waiting, ${u.stale} stale`}>
                  <i className="dot waiting" aria-hidden="true" />
                  {attn}
                  <span className="vh"> need attention</span>
                </span>
              )}
              <span className="cnt mono">
                {u.sessions.length}
                <span className="vh"> orchestrators</span>
              </span>
            </button>
            {rows.map((s) => item(s, groupish))}
          </div>
        );
      })}
    </>
  );
}
