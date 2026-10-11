import { currentStep } from "../logic";
import type { SessionView } from "../types";
import { GitLine, StatusChip } from "./Chips";
import { MiniCharts } from "./MiniCharts";

export function FocusHeader({ s, now }: { s: SessionView; now: number }) {
  const step = currentStep(s.plan);
  return (
    <div className="fh">
      <div className="id">
        <h1>
          <i className={`dot ${s.status}`} aria-hidden="true" />
          {s.name} <StatusChip status={s.status} />
        </h1>
        {s.plan ? (
          <div className="goal">
            {s.plan.title ?? "Plan"}
            {step ? <span> · now: {step}</span> : null}
          </div>
        ) : (
          <div className="goal">
            <span>No plan reported. Agents were launched ad hoc.</span>
          </div>
        )}
        <div className="sub mono">
          <span title="Working directory">{s.cwd}</span>
          <span title={`Session id ${s.id}`}>session {s.id.slice(0, 8)}</span>
          {s.repoName && <span title="Repository">{s.repoName}</span>}
        </div>
        <GitLine git={s.git} />
      </div>
      <MiniCharts s={s} now={now} />
    </div>
  );
}
