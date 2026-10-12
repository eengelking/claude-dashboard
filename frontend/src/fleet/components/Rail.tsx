import { agentCounts, planProgress } from "../logic";
import type { SessionView } from "../types";
import { BlowBadge, ModelChip, PlanBar } from "./Chips";
import { PaneTab } from "./PaneTab";

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
  collapsed?: boolean;
  onToggle?: () => void;
}) {
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
      {props.sessions.map((s) => {
        const p = planProgress(s.plan);
        const c = agentCounts(s.agents);
        const cls = `ritem${props.entering(s.id) ? " enter" : ""}${props.leaving[s.id] ? " leave" : ""}${s.blowouts.level === 2 ? " risk" : ""}`;
        const removable = s.status === "stale" && !!props.onRemove;
        return (
          <div key={s.id} className={`ritem-slot${removable ? " has-remove" : ""}`}>
          <button type="button" className={cls} aria-current={props.selected === s.id} onClick={() => props.onSelect(s.id)} disabled={!!props.leaving[s.id]}>
            <div className="l1">
              <i className={`dot ${s.status}`} aria-hidden="true" />
              <span className="nm">{s.name}</span>
              <span className="vh">{s.status}</span>
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
      })}
      </div>
    </nav>
  );
}
