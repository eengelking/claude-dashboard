import { planProgress } from "../logic";
import type { Plan, PlanStep } from "../types";
import { PlanBar } from "./Chips";
import { IconCheck } from "./Icons";

const SOURCE: Record<Plan["source"], string> = {
  TaskCreate: "Read from TaskCreate and TaskUpdate calls in the session.",
  TodoWrite: "Read from TodoWrite calls in the session.",
  podium_plan: "Named with the Podium plan tool; steps from the session's task calls.",
};

const STATE_WORD: Record<PlanStep["state"], string> = { done: "done", active: "in progress", blocked: "blocked", pending: "not started" };

function ownerLine(s: PlanStep): string {
  if (s.ownerLabel) return s.state === "blocked" ? `${s.ownerLabel} · blocked` : s.ownerLabel;
  if (s.state === "blocked") return "blocked by an unfinished step";
  if (s.state === "pending") return "not started";
  return s.state === "active" ? (s.activeText ?? "in progress") : "";
}

export function PlanPanel({ plan }: { plan: Plan | null }) {
  const p = planProgress(plan);
  return (
    <section className="sec" aria-label="Plan">
      <div className="sh">
        <h2>Plan{plan?.title ? ` · ${plan.title}` : ""}</h2>
        {p && (
          <span className="mono">
            {p.done}/{p.total}
          </span>
        )}
      </div>
      {plan && p ? (
        <>
          <div style={{ padding: "10px 12px 2px" }}>
            <PlanBar pct={p.pct} />
          </div>
          <ol className="steps">
            {plan.steps.map((s) => (
              <li key={s.id} className={`step ${s.state}`}>
                <span className="ic" aria-hidden="true">
                  {s.state === "done" ? <IconCheck /> : null}
                </span>
                <div className="tx">
                  {s.text}
                  <span className="vh"> ({STATE_WORD[s.state]})</span>
                  <div className="ow">{ownerLine(s)}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="foot-note">{SOURCE[plan.source]}</div>
        </>
      ) : (
        <div className="empty">No plan reported. Agents were launched ad hoc, so only the agent tree is available.</div>
      )}
    </section>
  );
}
