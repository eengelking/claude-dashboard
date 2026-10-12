import { fmtDur, fmtPct, fmtTok, fmtUsd } from "../format";
import { sessionElapsedSec } from "../logic";
import type { SessionView } from "../types";
import { reporterBelow, SkillChips, ToolChips } from "./AgentDetail";
import { BlowBadge, ContextBar, EffortMeter, GitLine, ModelChip, StatusChip } from "./Chips";
import { IconBack } from "./Icons";
import { HOOKS_NOTE, versionNote } from "./SessionCard";

/** The side panel for the orchestrator's own row. Steps, tools and skills come from the report's main loop block, when the reporter sends one. */
export function OrchestratorDetail(props: { s: SessionView; now: number; onBack: () => void }) {
  const { s, now } = props;
  return (
    <>
      <button type="button" className="back" onClick={props.onBack}>
        <IconBack />
        Back to activity
      </button>
      <div className="det">
        <h3>{s.name}</h3>
        <div>
          <StatusChip status={s.status} />
        </div>
        {s.reporter === "hooks" && <div className="note">{HOOKS_NOTE}</div>}
        {versionNote(s) && <div className="note">{versionNote(s)!.text}</div>}
        <dl className="grid2">
          <dt>Role</dt>
          <dd>Orchestrator</dd>
          <dt>Model</dt>
          <dd>
            <ModelChip family={s.modelFamily} model={s.model} />
          </dd>
          <dt>Effort</dt>
          <dd>
            <EffortMeter effort={s.effort} />
          </dd>
          <dt>Context</dt>
          <dd className="mono" style={{ flexWrap: "nowrap" }}>
            <ContextBar percent={s.context.percent} blowouts={s.blowouts.orchestrator} width={90} />
            <span>{fmtPct(s.context.percent)}</span>
            <BlowBadge n={s.blowouts.orchestrator} />
          </dd>
          <dt>Tokens</dt>
          <dd className="mono">{fmtTok(s.tokensTotal)}</dd>
          <dt>Est. cost</dt>
          <dd className="mono">{fmtUsd(s.costUsd)}</dd>
          <dt>Time</dt>
          <dd className="mono">{fmtDur(sessionElapsedSec(s, now))}</dd>
          {s.loop && (
            <>
              <dt>Steps</dt>
              <dd className="mono">{s.loop.steps.done} model requests</dd>
            </>
          )}
        </dl>
        {!s.loop && s.status !== "done" && reporterBelow(s, 4) && (
          <div className="note">
            Steps, tools and skills need podium-reporter 0.4.0 or later. This session reports {s.reporterVersion}. Run claude plugin update podium-reporter@eengelking-marketplace, then /reload-plugins in that session.
          </div>
        )}
        {s.loop && <ToolChips key={s.id} counts={s.loop.toolCounts} calls={s.loop.toolCalls} lastTool={s.loop.lastTool} />}
        {s.loop && <SkillChips skills={s.loop.skills} />}
        <GitLine git={s.git} />
        <div className="note">
          Tokens and cost cover the whole session, subagents included.
          {s.loop && " Steps, tools and skills are the orchestrator’s own, not its agents’."}
        </div>
      </div>
    </>
  );
}
