import { useId, useState, type KeyboardEvent } from "react";
import { inferredStep, planProgress } from "../logic";
import type { PlanStep, SessionView } from "../types";
import { PlanBar } from "./Chips";
import { FilesList } from "./FilesList";
import { PageNav } from "./PageNav";

/** The first reporter version that sends the changed files (SPEC 6.2). */
export const FILES_MIN_REPORTER = "0.6.0";
/** Steps shown per page; a plan of this many or fewer has no pager. */
export const STEPS_PER_PAGE = 10;
export type PlanTab = "plan" | "files";
const TABS: PlanTab[] = ["plan", "files"];

type StepShape = PlanStep["state"] | "inferred";

/** The mockup's step marks (podium-orchestrator.html, STEP): one distinct shape per state, so shape carries the state as well as color. */
function StepMark({ shape }: { shape: StepShape }) {
  const ring = <circle cx="7" cy="7" r="5.5" />;
  let body;
  if (shape === "done") {
    body = (
      <svg data-shape={shape} viewBox="0 0 14 14" fill="none" stroke="var(--good-text)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {ring}
        <path d="M4.4 7.2l1.8 1.8 3.4-3.7" />
      </svg>
    );
  } else if (shape === "active") {
    body = (
      <svg data-shape={shape} viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
        <circle className="pdot" cx="7" cy="7" r="2.6" fill="var(--ink)" />
      </svg>
    );
  } else if (shape === "blocked") {
    body = (
      <svg data-shape={shape} viewBox="0 0 14 14" fill="none" stroke="var(--serious-text)" strokeWidth="1.6" strokeLinecap="round">
        {ring}
        <path d="M3.2 10.8l7.6-7.6" />
      </svg>
    );
  } else {
    body = (
      <svg data-shape={shape} viewBox="0 0 14 14" fill="none" stroke="var(--muted)" strokeWidth="1.5">
        <circle cx="7" cy="7" r="5.5" strokeDasharray={shape === "inferred" ? "2.4 2" : undefined} />
      </svg>
    );
  }
  return <span className="mk" aria-hidden="true">{body}</span>;
}

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
  // Opens on the page holding the current step; after that the page is the viewer's, and only clamped when it no longer exists.
  // The page is settled once per session: a plan that arrives after mount, or another session shown in the same panel, gets its own opening page.
  const steps = plan?.steps ?? [];
  const openingPage = () => {
    const cur = steps.findIndex((x) => x.state === "active" || x.id === inferredId);
    return cur < 0 ? 0 : Math.floor(cur / STEPS_PER_PAGE);
  };
  const [view, setView] = useState<{ sid: string; page: number | null }>({ sid: s.id, page: steps.length > 0 ? openingPage() : null });
  let page = view.page ?? 0;
  if (view.sid !== s.id || (view.page === null && steps.length > 0)) {
    page = openingPage();
    setView({ sid: s.id, page: steps.length > 0 ? page : null });
  }
  const setPage = (n: number) => setView({ sid: s.id, page: n });
  const pages = Math.max(1, Math.ceil(steps.length / STEPS_PER_PAGE));
  const at = Math.min(page, pages - 1);
  const from = at * STEPS_PER_PAGE;
  const shown = steps.slice(from, from + STEPS_PER_PAGE);
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
            <div className="plan-prog">
              <PlanBar pct={p.pct} />
            </div>
            <ol className="steps">
              {shown.map((st) => (
                <li key={st.id} className={`step ${st.state}${st.id === inferredId ? " inferred" : ""}`}>
                  <StepMark shape={st.id === inferredId ? "inferred" : st.state} />
                  <div className="tx">
                    {st.text}
                    <span className="vh"> ({STATE_WORD[st.state]})</span>
                    <div className="ow">{st.id === inferredId ? ["up next · inferred", st.ownerLabel].filter(Boolean).join(" · ") : ownerLine(st)}</div>
                  </div>
                </li>
              ))}
            </ol>
            {pages > 1 && <PageNav label="Plan pages" at={at} pages={pages} from={from} shown={shown.length} total={steps.length} perPage={STEPS_PER_PAGE} onPage={setPage} />}
          </>
        ) : (
          <div className="empty">No plan reported. Agents were launched ad hoc.</div>
        )}
      </div>
      <div role="tabpanel" id={`${id}-files-panel`} aria-labelledby={`${id}-files`} hidden={tab !== "files"}>
        <FilesList report={files} hint={filesHint(s)} />
      </div>
    </section>
  );
}
