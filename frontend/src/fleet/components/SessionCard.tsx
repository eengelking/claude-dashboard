import { fmtCountdown, fmtDur, fmtPct, fmtTok, fmtUsd } from "../format";
import { agentCounts, currentStep, dropAtOf, planProgress, sessionElapsedSec } from "../logic";
import type { LifecycleConfig, SessionView } from "../types";
import { BlowBadge, cssVar, EffortMeter, FAMILY_COLOR, GitLine, ModelChip, PlanBar, StatusChip } from "./Chips";
import { toolOfNote, waitLead } from "../waiting";
import { IconWarn } from "./Icons";
import { Sparkline } from "./Sparkline";

export const HOOKS_NOTE = "Reported by Claude Code settings hooks, not the reporter mod: context, cost, tokens and the plan are unavailable.";

// The reporter clips a wait note at this many characters (LIMITS.waitNote); a note that long is cut off.
const WAIT_NOTE_LIMIT = 160;

/** The orchestrator page's callout: a plain lead, plus the tool or question as a secondary line when there is one. */
export function waitSummary(s: Pick<SessionView, "waitReason" | "waitNote">): { lead: string; detail: string | null } {
  const note = s.waitNote?.trim() ?? "";
  const tool = toolOfNote(note, s.waitReason);
  const lead = waitLead(s.waitReason, tool);
  if (!note) return { lead, detail: null };
  if (tool) return { lead, detail: `Tool: ${tool}` };
  // Anything else is shown only if it arrived whole; a clipped note would read as the full prompt.
  // Measure the raw note: the clip happens before the trim above.
  return { lead, detail: (s.waitNote?.length ?? 0) >= WAIT_NOTE_LIMIT ? null : note };
}

export function riskText(s: SessionView): string {
  const b = s.blowouts;
  return `Context exceeded ${b.total}× (${b.loopsHit} of ${b.loopsTotal} loops). Likely losing context; check for invented details.`;
}

export function SessionCard(props: { s: SessionView; now: number; config: LifecycleConfig; entering: boolean; leaving: boolean; onOpen: () => void; onRemove?: () => void }) {
  const { s, now, config } = props;
  const p = planProgress(s.plan);
  const c = agentCounts(s.agents);
  const step = currentStep(s.plan);
  const risk = s.blowouts.level === 2;
  const cls = `card${props.entering ? " enter" : ""}${props.leaving ? " leave" : ""}${risk ? " risk" : ""}`;
  const sinceSeen = Math.max(0, (now - s.lastSeenAt) / 1000);
  // The card is one big button, so Remove sits beside it in a slot rather than inside it.
  return (
    <div className={`card-slot${s.status === "stale" && props.onRemove ? " has-remove" : ""}`}>
    <button type="button" className={cls} onClick={props.onOpen} disabled={props.leaving} data-session={s.id}>
      <div className="h">
        <i className={`dot ${s.status}`} aria-hidden="true" />
        <span className="nm">{s.name}</span>
        <StatusChip status={s.status} />
      </div>
      <div className="path mono" title={s.project}>
        <bdi>{s.project}</bdi>
      </div>
      <GitLine git={s.git} />
      <div className="meta">
        <ModelChip family={s.modelFamily} model={s.model} />
        <EffortMeter effort={s.effort} />
        <span className="chip">
          ctx <span className="mono">{fmtPct(s.context.percent)}</span>
        </span>
        <BlowBadge n={s.blowouts.total} level={s.blowouts.level} />
        {s.reporter === "hooks" && (
          <span className="chip" title={HOOKS_NOTE}>
            settings hooks
          </span>
        )}
      </div>
      {risk && (
        <div className="alert risk">
          <IconWarn /> <span>{riskText(s)}</span>
        </div>
      )}
      {p ? (
        <div className="plan">
          <div className="t">
            <span>
              {s.plan?.title ?? "Plan"}
              {step ? ` · ${step}` : ""}
            </span>
            <span className="mono">
              {p.done}/{p.total}
            </span>
          </div>
          <PlanBar pct={p.pct} />
        </div>
      ) : (
        <div className="noplan">No plan reported. Agents were launched ad hoc.</div>
      )}
      <div className="crew" aria-label={`${c.running} running, ${c.done} done of ${c.all} agents`}>
        {s.agents.map((a) => (
          <span
            key={a.id}
            className={`a ${a.status === "aborted" ? "done" : a.status}${a.kind === "fork" ? " fork" : ""}`}
            style={cssVar(FAMILY_COLOR[a.modelFamily])}
            title={`${a.description} · ${a.status}`}
          />
        ))}
        <span className="mono cnt">
          {c.running} running · {c.done} done{c.failed ? ` · ${c.failed} failed` : ""}
        </span>
      </div>
      {/* The card stays short: the sentence only. The orchestrator page adds the tool name or question (waitSummary). */}
      {s.status === "waiting" && <div className="alert">{waitSummary(s).lead}</div>}
      {s.status === "stale" && (
        <div className="alert stale">
          Last heartbeat <span className="mono">{fmtDur(sinceSeen)}</span> ago. Goes away in{" "}
          <span className="mono">{fmtCountdown((dropAtOf(s, config) - now) / 1000)}</span>.
        </div>
      )}
      <div className="foot">
        <div className="mono">
          <span className="v">{fmtUsd(s.costUsd)} ·</span>{" "}
          <span className="v">{fmtTok(s.tokensTotal)} tok ·</span>{" "}
          <span className="v">{fmtDur(sessionElapsedSec(s, now))}</span>
        </div>
        <Sparkline values={s.series.tokensPerSec} w={100} h={22} />
      </div>
    </button>
    {s.status === "stale" && props.onRemove && (
      <div className="remove-bar">
      <button type="button" className="btn remove" onClick={props.onRemove} disabled={props.leaving} aria-label={`Remove ${s.name} from the fleet`}>
        Remove
      </button>
      </div>
    )}
    </div>
  );
}
