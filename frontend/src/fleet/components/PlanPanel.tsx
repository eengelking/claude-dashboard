import { useId, useState, type KeyboardEvent } from "react";
import { inferredStep, planProgress } from "../logic";
import type { Plan, PlanStep, SessionView } from "../types";
import { PlanBar } from "./Chips";
import { FilesList } from "./FilesList";
import { IconCheck } from "./Icons";

/** The first reporter version that sends the changed files (SPEC 6.2). */
export const FILES_MIN_REPORTER = "0.6.0";
export type PlanTab = "plan" | "files";
const TABS: PlanTab[] = ["plan", "files"];

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

function filesHint(s: Pick<SessionView, "files" | "reporter" | "reporterVersion">): string | null {
  if (s.files) return null;
  if (s.reporter === "hooks") return "This is a hook-only session, which does not send files. Load the podium-reporter mod to see them.";
  return `This session's reporter is ${s.reporterVersion ?? "an older version"} and does not send files. Update podium-reporter to ${FILES_MIN_REPORTER} to see them.`;
}

export function PlanPanel({ s, onTab }: { s: SessionView; onTab?: (tab: PlanTab) => void }) {
  const [tab, setTab] = useState<PlanTab>("plan");
  const id = useId();
  const { plan, files } = s;
  const p = planProgress(plan);
  const inferredId = inferredStep(plan)?.id;
  const pick = (t: PlanTab) => {
    setTab(t);
    onTab?.(t);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    const next = TABS[(j + TABS.length) % TABS.length]!;
    pick(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  const count = files?.total ?? 0;
  return (
    <section className="sec" aria-label="Plan and files">
      <div className="tabs" role="tablist" aria-label="Plan and files">
        {TABS.map((t, i) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-${t}`}
            aria-selected={tab === t}
            aria-controls={`${id}-${t}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => pick(t)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t === "plan" ? "Plan" : "Files"}
            {t === "files" && count > 0 && <span className="ct"> {count}</span>}
          </button>
        ))}
        {tab === "plan" && p && <span className="meta mono">{p.done}/{p.total}</span>}
      </div>
      <div role="tabpanel" id={`${id}-plan-panel`} aria-labelledby={`${id}-plan`} hidden={tab !== "plan"}>
        {plan && p ? (
          <>
            {plan.title && <div className="plan-title">{plan.title}</div>}
            <div style={{ padding: "10px 12px 2px" }}>
              <PlanBar pct={p.pct} />
            </div>
            <ol className="steps">
              {plan.steps.map((st) => (
                <li key={st.id} className={`step ${st.state}${st.id === inferredId ? " inferred" : ""}`}>
                  <span className="ic" aria-hidden="true">
                    {st.state === "done" ? <IconCheck /> : null}
                  </span>
                  <div className="tx">
                    {st.text}
                    <span className="vh"> ({STATE_WORD[st.state]})</span>
                    <div className="ow">{st.id === inferredId ? ["up next · inferred", st.ownerLabel].filter(Boolean).join(" · ") : ownerLine(st)}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="foot-note">{SOURCE[plan.source]}</div>
          </>
        ) : (
          <div className="empty">No plan reported. Agents were launched ad hoc, so only the agent tree is available.</div>
        )}
      </div>
      <div role="tabpanel" id={`${id}-files-panel`} aria-labelledby={`${id}-files`} hidden={tab !== "files"}>
        <FilesList report={files} hint={filesHint(s)} />
      </div>
    </section>
  );
}
