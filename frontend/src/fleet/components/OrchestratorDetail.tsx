import { fmtDur, fmtPct, fmtTok, fmtUsd } from "../format";
import { sessionElapsedSec } from "../logic";
import type { SessionView } from "../types";
import { BlowBadge, ContextBar, EffortMeter, GitLine, ModelChip, StatusChip } from "./Chips";
import { IconBack } from "./Icons";
import { HOOKS_NOTE } from "./SessionCard";

/** The side panel for the orchestrator's own row. The report carries the main loop only as session-level fields. */
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
        </dl>
        <GitLine git={s.git} />
        <div className="note">
          Tokens and cost cover the whole session, subagents included. Tools and skills are not reported for the main loop yet.
        </div>
      </div>
    </>
  );
}
