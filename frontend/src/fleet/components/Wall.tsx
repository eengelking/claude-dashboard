import { fmtTok, fmtUsd } from "../format";
import { SORTS, STATUS_FILTERS, type SortKey, type StatusFilter } from "../logic";
import type { Kpis, LifecycleConfig, ModelFamily, SessionView } from "../types";
import { ModelChip, NO_PRICE_TITLE } from "./Chips";
import { splitText, type Split } from "./Rail";
import { SessionCard } from "./SessionCard";
import { Sparkline } from "./Sparkline";

export function KpiStrip({ kpis, split }: { kpis: Kpis | null; split: Split }) {
  const k = kpis;
  const lvl2 = k?.sessionsAtLevel2 ?? 0;
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="k">Orchestrators live</div>
        <div className="v mono">{k?.live ?? "–"}</div>
        <div className="kpi-cap">{splitText(split)}</div>
      </div>
      <div className="kpi">
        <div className="k">Agents running</div>
        <div className="v mono">
          <span>{k?.agentsRunning ?? "–"}</span>
          <small>of {k?.agentsTotal ?? 0} this run</small>
        </div>
        <div className="kpi-cap">subagents and forks</div>
      </div>
      <div className="kpi">
        <div className="k">Context blowouts</div>
        <div className="v mono">
          <span>{k?.blowoutsTotal ?? "–"}</span>
        </div>
        <div className="kpi-cap">{lvl2 ? `${lvl2} session${lvl2 > 1 ? "s" : ""} repeatedly over the limit` : "none repeating"}</div>
      </div>
      <div className="kpi">
        <div className="k">Plan steps done</div>
        <div className="v mono">{k ? `${k.planDone}/${k.planTotal}` : "–"}</div>
        <div className="kpi-cap">across all plans</div>
      </div>
      <div className="kpi">
        <div className="k">Est. cost today</div>
        <div className="v mono">{k ? fmtUsd(k.costToday) : "–"}</div>
        {k && k.unpricedSessions > 0 ? (
          <div className="kpi-cap" title={NO_PRICE_TITLE}>
            not counting {k.unpricedSessions} unpriced session{k.unpricedSessions > 1 ? "s" : ""}
          </div>
        ) : (
          <Sparkline values={k?.costPerMinute ?? []} w={100} h={26} />
        )}
      </div>
      <div className="kpi">
        <div className="k">Tokens, last minute</div>
        <div className="v mono">{k ? fmtTok(k.tokensLastMinute) : "–"}</div>
        <Sparkline values={k?.tokensPerSec ?? []} w={100} h={26} />
      </div>
    </div>
  );
}

export function Toolbar(props: {
  filter: { status: StatusFilter; q: string };
  onFilter: (f: { status: StatusFilter; q: string }) => void;
  sort: SortKey;
  onSort: (k: SortKey) => void;
  shown: number;
  cleared: number;
}) {
  const { filter } = props;
  return (
    <div className="tools">
      <div className="seg" role="group" aria-label="Filter by status">
        {(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((k) => (
          <button type="button" key={k} aria-pressed={filter.status === k} onClick={() => props.onFilter({ ...filter, status: k })}>
            {STATUS_FILTERS[k]}
          </button>
        ))}
      </div>
      <label className="sortlab" htmlFor="podium-sort">
        Sort by
      </label>
      <select className="sel" id="podium-sort" value={props.sort} onChange={(e) => props.onSort(e.target.value as SortKey)}>
        {(Object.keys(SORTS) as SortKey[]).map((k) => (
          <option key={k} value={k}>
            {SORTS[k]}
          </option>
        ))}
      </select>
      <input
        className="search"
        type="search"
        placeholder="Filter by name, project or branch"
        aria-label="Filter orchestrators"
        value={filter.q}
        onChange={(e) => props.onFilter({ ...filter, q: e.target.value })}
      />
      <span className="spacer" />
      <span className="kpi-cap">
        {props.shown} shown · {props.cleared} cleared today
      </span>
    </div>
  );
}

export function Legend() {
  const fams: ModelFamily[] = ["opus", "sonnet", "haiku", "fable"];
  return (
    <div className="legend" aria-label="Legend">
      <span>
        <i className="a" />
        subagent (blank slate)
      </span>
      <span>
        <i className="a f" />
        fork (keeps context)
      </span>
      <span>
        <i className="a q" />
        queued
      </span>
      <span>
        <i className="a d" />
        done
      </span>
      <span>
        Square color is the model:{" "}
        {fams.map((f) => (
          <ModelChip key={f} family={f} />
        ))}
      </span>
    </div>
  );
}

export function Wall(props: {
  sessions: SessionView[];
  totalLive: number;
  kpis: Kpis | null;
  split: Split;
  filter: { status: StatusFilter; q: string };
  onFilter: (f: { status: StatusFilter; q: string }) => void;
  sort: SortKey;
  onSort: (k: SortKey) => void;
  cleared: number;
  now: number;
  config: LifecycleConfig;
  entering: (id: string) => boolean;
  leaving: Record<string, number>;
  onOpen: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <>
      <KpiStrip kpis={props.kpis} split={props.split} />
      <Toolbar filter={props.filter} onFilter={props.onFilter} sort={props.sort} onSort={props.onSort} shown={props.sessions.length} cleared={props.cleared} />
      {props.sessions.length ? (
        <div className="wall">
          {props.sessions.map((s) => (
            <SessionCard
              key={s.id}
              s={s}
              now={props.now}
              config={props.config}
              entering={props.entering(s.id)}
              leaving={!!props.leaving[s.id]}
              onOpen={() => props.onOpen(s.id)}
              onRemove={props.onRemove ? () => props.onRemove?.(s.id) : undefined}
            />
          ))}
        </div>
      ) : props.totalLive ? (
        <div className="none">No orchestrators match. Clear the filter to see all {props.totalLive}.</div>
      ) : (
        <div className="none">
          <b>No Claude Code sessions are reporting.</b>
          <br />
          Start one with the reporter mod: <code>claude --plugin-dir mod/podium-reporter</code>, or run the simulator:{" "}
          <code>npm run podium:sim</code>.
        </div>
      )}
      <Legend />
    </>
  );
}
