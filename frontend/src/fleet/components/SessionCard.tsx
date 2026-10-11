import { fmtDur, fmtPct, fmtTok, fmtUsd } from "../format";
import { agentCounts, currentStep, planProgress, sessionElapsedSec } from "../logic";
import type { LifecycleConfig, SessionView } from "../types";
import { BlowBadge, cssVar, EffortMeter, FAMILY_COLOR, GitLine, ModelChip, PlanBar, StatusChip } from "./Chips";
import { IconWarn } from "./Icons";
import { Sparkline } from "./Sparkline";

export const HOOKS_NOTE = "Reported by Claude Code settings hooks, not the reporter mod: context, cost, tokens and the plan are unavailable.";

export function waitText(s: Pick<SessionView, "waitReason" | "waitNote">): string {
  if (s.waitReason === "permission") return `Permission prompt: ${s.waitNote ?? "a tool call needs your approval"}`;
  if (s.waitReason === "input") return s.waitNote ? `Waiting for your input: ${s.waitNote}` : "Waiting for your input.";
  return s.waitNote ?? "Waiting on you.";
}

export function riskText(s: SessionView): string {
  const b = s.blowouts;
  return `Context exceeded ${b.total}× (${b.loopsHit} of ${b.loopsTotal} loops). Likely losing context; check for invented details.`;
}

export function SessionCard(props: { s: SessionView; now: number; config: LifecycleConfig; entering: boolean; leaving: boolean; onOpen: () => void }) {
  const { s, now, config } = props;
  const p = planProgress(s.plan);
  const c = agentCounts(s.agents);
  const step = currentStep(s.plan);
  const risk = s.blowouts.level === 2;
  const cls = `card${props.entering ? " enter" : ""}${props.leaving ? " leave" : ""}${risk ? " risk" : ""}`;
  const sinceSeen = Math.max(0, (now - s.lastSeenAt) / 1000);
  return (
    <button type="button" className={cls} onClick={props.onOpen} disabled={props.leaving} data-session={s.id}>
      <div className="h">
        <i className={`dot ${s.status}`} aria-hidden="true" />
        <span className="nm">{s.name}</span>
        <StatusChip status={s.status} />
      </div>
      <div className="path mono">{s.project}</div>
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
      {s.status === "waiting" && <div className="alert">{waitText(s)}</div>}
      {s.status === "stale" && (
        <div className="alert stale">
          Last heartbeat <span className="mono">{fmtDur(sinceSeen)}</span> ago. Dropped from the fleet at{" "}
          {fmtDur((config.staleAfterMs + config.dropAfterMs) / 1000)}.
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
  );
}
