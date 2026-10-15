import { currentStep, inferredStep, planComplete } from "../logic";
import type { SessionView } from "../types";
import { GitLine, StateIcon } from "./Chips";
import { MiniCharts } from "./MiniCharts";
import { pageKind } from "./StatusBand";

/** Layer one of the summary surface: who it is, what it is doing, where. The state shape beside the name is the status band's shape. */
export function FocusHeader({ s, now }: { s: SessionView; now: number }) {
  const step = currentStep(s.plan);
  const next = step ? null : inferredStep(s.plan);
  return (
    <div className="fh">
      <div className="id">
        <h1>
          <span className="sd">
            <StateIcon kind={pageKind(s)} />
          </span>
          {s.name}
        </h1>
        {s.plan ? (
          <div className="goal">
            {s.plan.title ?? "Plan"}
            {step ? <span> · now: {step}</span> : null}
            {next ? (
              <span title="Claude has not marked this in progress yet. Podium shows the first step not started.">
                {" "}· now: {next.text} <em>(inferred)</em>
              </span>
            ) : null}
            {planComplete(s.plan) ? <span> · plan complete</span> : null}
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
