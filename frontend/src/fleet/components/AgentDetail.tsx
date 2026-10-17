import { useState } from "react";
import { fmtDur, fmtPct, fmtTok, fmtUsd } from "../format";
import { agentElapsedSec, agentTokens, branchTotals, COST_HINT_AGENT, parentOf, reporterBelow, TOKENS_HINT } from "../logic";
import type { AgentView, SessionView } from "../types";
import { BlowoutBox } from "./BlowoutBox";
import { BlowBadge, Cost, ContextBar, cssVar, EffortMeter, FAMILY_COLOR, ModelChip, StatusChip } from "./Chips";
import { FailureBox } from "./FailureBox";
import { IconBack, IconFork, IconSub } from "./Icons";
import { ReportDocs } from "./ReportDocs";
import { ActivityFeed } from "./ActivityFeed";
import { Tip } from "./Tip";

const TOOL_CHIPS_SHOWN = 5;

/** Tools the agent used, most used first (ties by name); the five most used unless expanded. */
export function ToolChips(props: { counts: Record<string, number>; calls: number; lastTool: string | null }) {
  const [all, setAll] = useState(false);
  const sorted = Object.entries(props.counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shown = all ? sorted : sorted.slice(0, TOOL_CHIPS_SHOWN);
  const lastHidden = props.lastTool !== null && sorted.some(([k]) => k === props.lastTool) && !shown.some(([k]) => k === props.lastTool);
  return (
    <>
      <span className="lab">
        Tools used <span className="mono">({props.calls} calls)</span>
      </span>
      <div className="chips">
        {sorted.length ? (
          shown.map(([name, n]) => (
            <span key={name} className={`chip skill tool${name === props.lastTool ? " latest" : ""}`}>
              {name}{" "}
              <span className="n">{n}</span>
              {name === props.lastTool && <span className="sr-only"> (last used)</span>}
            </span>
          ))
        ) : (
          <span style={{ color: "var(--muted)" }}>None seen</span>
        )}
        {sorted.length > TOOL_CHIPS_SHOWN && (
          <button type="button" className="more" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${sorted.length}`}
          </button>
        )}
      </div>
      {lastHidden && <div className="tools-latest">Last used: {props.lastTool}</div>}
    </>
  );
}

/** Skills a loop loaded, as chips; "None seen" when there are none. */
export function SkillChips(props: { skills: string[] }) {
  return (
    <>
      <span className="lab">Skills loaded</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {props.skills.length ? (
          props.skills.map((k) => (
            <span key={k} className="chip skill">
              {k}
            </span>
          ))
        ) : (
          <span style={{ color: "var(--muted)" }}>None seen</span>
        )}
      </div>
    </>
  );
}

export { reporterBelow } from "../logic";

/** True for a mod older than 0.2.0, the first to send per-tool counts. */
const reporterLacksToolCounts = (s: Pick<SessionView, "reporter" | "reporterVersion">) => reporterBelow(s, 2);

export function AgentDetail(props: { s: SessionView; a: AgentView; now: number; onBack: () => void; onAgent: (id: string) => void; activityFeedOn?: boolean }) {
  const { s, a, now } = props;
  const kids = s.agents.filter((x) => x.parentId === a.id && x.id !== a.id);
  const parent = parentOf(s.agents, a);
  const branch = kids.length ? branchTotals(s.agents, a.id) : null;
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
          <dt>Launched by</dt>
          <dd>
            {parent ? (
              <button type="button" className="linkbtn" onClick={() => props.onAgent(parent.id)}>
                {parent.description}
              </button>
            ) : a.parentId && a.parentId !== a.id ? (
              "an agent no longer listed"
            ) : (
              "the orchestrator"
            )}
          </dd>
          <dt>Kind</dt>
          <dd>
            <Tip className="kind" style={cssVar(FAMILY_COLOR[a.modelFamily])} text={kindNote}>
              {fork ? <IconFork /> : <IconSub />}
              {kindWord}
            </Tip>
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
          <dt title={TOKENS_HINT}>Tokens</dt>
          <dd className="mono" title={TOKENS_HINT}>{fmtTok(agentTokens(a))}</dd>
          <dt>Used so far</dt>
          <dd className="mono" title="Running totals over every model request, cache re-reads included">
            {fmtTok(a.tokens.input)} in · {fmtTok(a.tokens.output)} out · {fmtTok(a.tokens.cacheRead)} cache read · {fmtTok(a.tokens.cacheWrite)} cache write
          </dd>
          <dt>Est. cost</dt>
          <dd className="mono" title={COST_HINT_AGENT}>
            <Cost usd={a.costUsdEst} family={a.modelFamily} /> <span style={{ color: "var(--muted)" }}>own</span>
          </dd>
          {branch && (
            <>
              <dt>With its agents</dt>
              <dd className="mono" title="This agent plus every agent under it, at every level, each counted once. Tokens are the context each holds now.">
                {fmtUsd(branch.costUsd)} · {fmtTok(branch.tokens)} tok{" "}
                <span style={{ color: "var(--muted)" }}>
                  ({branch.agents} agent{branch.agents === 1 ? "" : "s"}
                  {branch.unpriced ? `, ${branch.unpriced} not priced` : ""})
                </span>
              </dd>
            </>
          )}
          <dt>Time</dt>
          <dd className="mono">{fmtDur(agentElapsedSec(a, now))}</dd>
          <dt>Steps</dt>
          <dd className="mono">{a.steps ? `${a.steps.done}${a.steps.total !== null ? `/${a.steps.total}` : ""} model requests` : "–"}</dd>
          {a.toolCounts === null && (
            <>
              <dt>Last tool</dt>
              <dd className="mono">
                {a.lastTool ?? "–"}
                {a.toolCalls ? <span style={{ color: "var(--muted)" }}>({a.toolCalls} calls)</span> : null}
              </dd>
            </>
          )}
        </dl>
        {a.toolCounts === null && reporterLacksToolCounts(s) && (
          <div className="note">
            Tool counts need podium-reporter 0.2.0 or later. This session reports {s.reporterVersion}. Run claude plugin update podium-reporter@eengelking-marketplace, then /reload-plugins in that session.
          </div>
        )}
        {a.toolCounts !== null && <ToolChips key={a.id} counts={a.toolCounts} calls={a.toolCalls} lastTool={a.lastTool} />}
        <SkillChips skills={a.skills} />
        <ReportDocs s={s} a={a} />
        <ActivityFeed key={`${s.id}:${a.id}:activity`} s={s} loop={a.id} title={`${a.description} · ${a.type}`} startedAt={a.startedAt} active={a.status === "running" || a.status === "queued"} now={now} adminOn={props.activityFeedOn} />
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
