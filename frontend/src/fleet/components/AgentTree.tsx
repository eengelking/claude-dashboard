import { useEffect, useRef } from "react";
import { fmtDur, fmtPct, fmtTok } from "../format";
import { buildTree, delegateText, ORCHESTRATOR_ROW, sessionElapsedSec, sortAgents, TOKENS_HINT, waitingOnByRow, type AgentSortKey } from "../logic";
import type { SessionView } from "../types";
import { AgentRow } from "./AgentRow";
import { BlowBadge, Cost, ContextBar, EffortMeter, ModelChip, StatusChip } from "./Chips";
import { IconOrch } from "./Icons";

export interface AgentSort {
  key: AgentSortKey | null;
  dir: 1 | -1;
}

const HEADERS: { key: AgentSortKey; label: string; cls?: string }[] = [
  { key: "model", label: "Model" },
  { key: "effort", label: "Effort" },
  { key: "ctx", label: "Context" },
  { key: "tok", label: "Tokens", cls: "num c-tok" },
  { key: "cost", label: "Cost", cls: "num" },
  { key: "time", label: "Time", cls: "num" },
  { key: "status", label: "Status" },
];

export function AgentTree(props: {
  s: SessionView;
  now: number;
  sort: AgentSort;
  onSort: (key: AgentSortKey | null) => void;
  selectedAgent: string | null;
  flashAgent: string | null;
  onSelect: (id: string) => void;
}) {
  const { s, now, sort } = props;
  const rows = sort.key ? sortAgents(s.agents, sort.key, sort.dir, now).map((a) => ({ agent: a, guides: [] })) : buildTree(s.agents);
  const waiting = waitingOnByRow(s);
  const delegating = (id: string) => {
    const kids = waiting.get(id);
    return kids ? delegateText(kids) : undefined;
  };
  const flashRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (props.flashAgent && flashRef.current?.scrollIntoView) flashRef.current.scrollIntoView({ block: "center" });
  }, [props.flashAgent]);
  return (
    <section className="sec" aria-label="Agents">
      <div className="sh">
        <h2>Agents</h2>
        <span className="src">
          {sort.key ? (
            <button type="button" className="btn" onClick={() => props.onSort(null)}>
              Show as tree
            </button>
          ) : (
            `${s.agents.length} launched · click a header to sort`
          )}
        </span>
      </div>
      <div className="tw">
        <div className="trow hd" role="row">
          <div>Task</div>
          {HEADERS.map((h) => {
            const on = sort.key === h.key;
            return (
              <div key={h.key} className={h.cls}>
                <button type="button" aria-pressed={on} onClick={() => props.onSort(h.key)} title={h.key === "tok" ? `Sort by tokens. ${TOKENS_HINT}` : `Sort by ${h.label.toLowerCase()}`}>
                  {h.label}
                  {on ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="trow root"
          aria-current={props.selectedAgent === ORCHESTRATOR_ROW}
          onClick={() => props.onSelect(ORCHESTRATOR_ROW)}
          data-agent={ORCHESTRATOR_ROW}
        >
          <div className="nm">
            <IconOrch />
            <span className="tx">
              <b>{s.name}</b>
              <em>orchestrator</em>
            </span>
          </div>
          <div className="cell">
            <ModelChip family={s.modelFamily} model={s.model} />
          </div>
          <div className="cell">
            <EffortMeter effort={s.effort} />
          </div>
          <div className="ctxc">
            <ContextBar percent={s.context.percent} blowouts={s.blowouts.orchestrator} />
            <span>{fmtPct(s.context.percent)}</span>
            <BlowBadge n={s.blowouts.orchestrator} />
          </div>
          <div className="num c-tok" title={TOKENS_HINT}>{fmtTok(s.context.tokens)}</div>
          <div className="num"><Cost usd={s.costUsd} family={s.modelFamily} /></div>
          <div className="num">{fmtDur(sessionElapsedSec(s, now))}</div>
          <div className="cell">
            <StatusChip status={s.status} delegating={delegating(ORCHESTRATOR_ROW)} />
          </div>
        </button>
        {rows.length ? (
          rows.map((r) => (
            <AgentRow
              key={r.agent.id}
              ref={props.flashAgent === r.agent.id ? flashRef : undefined}
              a={r.agent}
              guides={r.guides}
              now={now}
              selected={props.selectedAgent === r.agent.id}
              flash={props.flashAgent === r.agent.id}
              delegating={delegating(r.agent.id)}
              onSelect={props.onSelect}
            />
          ))
        ) : (
          <div className="empty">No agents launched yet.</div>
        )}
      </div>
    </section>
  );
}
