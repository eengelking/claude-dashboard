import { fmtDur, fmtPct, fmtTok, fmtUsd } from "../format";
import { agentElapsedSec, agentTokens } from "../logic";
import type { AgentView, SessionView } from "../types";
import { BlowoutBox } from "./BlowoutBox";
import { BlowBadge, ContextBar, cssVar, EffortMeter, FAMILY_COLOR, ModelChip, StatusChip } from "./Chips";
import { FailureBox } from "./FailureBox";
import { IconBack, IconFork, IconSub } from "./Icons";

export function AgentDetail(props: { s: SessionView; a: AgentView; now: number; onBack: () => void; onAgent: (id: string) => void }) {
  const { s, a, now } = props;
  const kids = s.agents.filter((x) => x.parentId === a.id);
  const fork = a.kind === "fork";
  const [kindWord, kindNote] = fork
    ? ["Fork", "Keeps the parent’s context and memory."]
    : a.kind === "teammate"
      ? ["Teammate", "A named agent of the session’s team."]
      : ["Subagent", "Starts from a blank slate."];
  const inherited = <span style={{ color: "var(--muted)" }}>inherited</span>;
  return (
    <>
      <button type="button" className="back" onClick={props.onBack}>
        <IconBack />
        Back to activity
      </button>
      <div className="det">
        <h3>{a.description}</h3>
        <div>
          <StatusChip status={a.status} />
        </div>
        {a.failure && <FailureBox f={a.failure} />}
        <BlowoutBox a={a} log={s.blowouts.log} />
        <dl className="grid2">
          <dt>Orchestrator</dt>
          <dd>{s.name}</dd>
          <dt>Kind</dt>
          <dd>
            <span className="kind" style={cssVar(FAMILY_COLOR[a.modelFamily])} tabIndex={0} data-tip={kindNote} aria-describedby={`kind-${a.id}`}>
              {fork ? <IconFork /> : <IconSub />}
              {kindWord}
            </span>
            <span id={`kind-${a.id}`} hidden>
              {kindNote}
            </span>
          </dd>
          <dt>Type</dt>
          <dd className="mono">{a.type}</dd>
          {a.name && (
            <>
              <dt>Name</dt>
              <dd className="mono">{a.name}</dd>
            </>
          )}
          <dt>Model</dt>
          <dd>
            <ModelChip family={a.modelFamily} model={a.model} />
            {fork && inherited}
          </dd>
          <dt>Effort</dt>
          <dd>
            <EffortMeter effort={a.effort} />
            {fork || a.effortSource === "inherited" ? inherited : a.effortSource !== "unknown" ? <span style={{ color: "var(--muted)" }}>{a.effortSource}</span> : null}
          </dd>
          <dt>Context</dt>
          <dd className="mono" style={{ flexWrap: "nowrap" }}>
            <ContextBar percent={a.context.percent} blowouts={a.blowouts} width={90} />
            <span>{fmtPct(a.context.percent)}</span>
            <BlowBadge n={a.blowouts} />
          </dd>
          <dt>Tokens</dt>
          <dd className="mono">{fmtTok(agentTokens(a))}</dd>
          <dt>Est. cost</dt>
          <dd className="mono">{fmtUsd(a.costUsdEst)}</dd>
          <dt>Time</dt>
          <dd className="mono">{fmtDur(agentElapsedSec(a, now))}</dd>
          <dt>Steps</dt>
          <dd className="mono">{a.steps ? `${a.steps.done}${a.steps.total !== null ? `/${a.steps.total}` : ""} model requests` : "–"}</dd>
          <dt>Last tool</dt>
          <dd className="mono">
            {a.lastTool ?? "–"}
            {a.toolCalls ? <span style={{ color: "var(--muted)" }}>({a.toolCalls} calls)</span> : null}
          </dd>
        </dl>
        <span className="lab">Skills loaded</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {a.skills.length ? (
            a.skills.map((k) => (
              <span key={k} className="chip skill">
                {k}
              </span>
            ))
          ) : (
            <span style={{ color: "var(--muted)" }}>None seen</span>
          )}
        </div>
        <span className="lab">Task prompt</span>
        <div className="pr">{a.promptExcerpt || "Not reported."}</div>
        {a.answerExcerpt && (
          <>
            <span className="lab">Final answer</span>
            <div className="pr">{a.answerExcerpt}</div>
          </>
        )}
        {kids.length > 0 && (
          <>
            <span className="lab">Launched by this agent</span>
            <div style={{ display: "grid", gap: 4 }}>
              {kids.map((k) => (
                <button type="button" key={k.id} className="btn" onClick={() => props.onAgent(k.id)}>
                  {k.kind === "fork" ? <IconFork /> : <IconSub />}
                  {k.description}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="note">Model and effort come from the spawn call and the model requests seen since. Effort on a fork always matches its parent.</div>
      </div>
    </>
  );
}
