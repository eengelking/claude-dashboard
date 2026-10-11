import { agentCounts, planProgress } from "../logic";
import type { SessionView } from "../types";
import { BlowBadge, ModelChip, PlanBar } from "./Chips";

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
}) {
  return (
    <nav className="rail" aria-label="Orchestrators">
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
        return (
          <button type="button" key={s.id} className={cls} aria-current={props.selected === s.id} onClick={() => props.onSelect(s.id)} disabled={!!props.leaving[s.id]}>
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
        );
      })}
    </nav>
  );
}
