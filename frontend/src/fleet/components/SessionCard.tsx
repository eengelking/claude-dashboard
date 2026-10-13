import { fmtCountdown, fmtDur, fmtPct, fmtTok } from "../format";
import { agentCounts, COST_HINT_SESSION, currentStep, dropAtOf, planProgress, sessionElapsedSec, sessionTokens, TOKENS_HINT, treeOrder } from "../logic";
import type { LifecycleConfig, SessionView } from "../types";
import { BlowBadge, Cost, cssVar, EffortMeter, FAMILY_COLOR, GitLine, ModelChip, PlanBar, StatusChip } from "./Chips";
import { toolOfNote, waitLead } from "../waiting";
import { IconWarn } from "./Icons";
import { Sparkline } from "./Sparkline";
import { OwnerLine } from "./People";

export const HOOKS_NOTE = "Reported by Claude Code settings hooks, not the reporter mod: context, cost, tokens, the plan and which agent launched which are unavailable, so every agent shows under the orchestrator.";

/** What to tell the user when the server places this session's reporter outside the range it supports; null when it does not. */
export function versionNote(s: Pick<SessionView, "compat" | "reporterVersion">): { chip: string; text: string } | null {
  const v = s.reporterVersion ?? "unknown";
  if (s.compat === "outdated") return { chip: `reporter ${v} · update`, text: `This session's reporter (${v}) is older than the server supports. Update the podium-reporter mod: run claude plugin update podium-reporter@eengelking-marketplace, then /reload-plugins in that session. Reports are still accepted, but newer fields may be missing.` };
  if (s.compat === "newer") return { chip: `reporter ${v} · upgrade server`, text: `This session's reporter (${v}) is newer than the server supports. Upgrade the Podium server. Reports are still accepted, but some fields may be ignored.` };
  return null;
}

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

/** In the people view: the machine label, and whether the card names its owner (not in that owner's own band). */
export interface CardOwner {
  machine: string | null;
  showName: boolean;
}

export function SessionCard(props: { s: SessionView; now: number; config: LifecycleConfig; entering: boolean; leaving: boolean; onOpen: () => void; onRemove?: () => void; owner?: CardOwner }) {
  const { s, now, config } = props;
  const p = planProgress(s.plan);
  const c = agentCounts(s.agents);
  const byId = new Map(s.agents.map((a) => [a.id, a]));
  const step = currentStep(s.plan);
  const risk = s.blowouts.level === 2;
  const vNote = versionNote(s);
  const detached = s.attached === false;
  const cls = `card${props.entering ? " enter" : ""}${props.leaving ? " leave" : ""}${risk ? " risk" : ""}${detached ? " detached" : ""}`;
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
      {props.owner && <OwnerLine owner={s.owner} machine={props.owner.machine} showName={props.owner.showName} />}
      <div className="meta">
        <ModelChip family={s.modelFamily} model={s.model} />
        <EffortMeter effort={s.effort} />
        <span className="chip">
          ctx <span className="mono">{fmtPct(s.context.percent)}</span>
        </span>
        <BlowBadge n={s.blowouts.total} level={s.blowouts.level} />
        {detached && (
          <span className="chip detached" title="No window is attached to this session. Run claude attach to reopen it.">
            nobody attached
          </span>
        )}
        {detached && s.hideAt !== null && s.hideAt > now && (
          <span className="chip">
            hides in <span className="mono">{fmtCountdown((s.hideAt - now) / 1000)}</span>
          </span>
        )}
        {s.reporter === "hooks" && (
          <span className="chip" title={HOOKS_NOTE}>
            settings hooks
          </span>
        )}
        {vNote && (
          <span className="chip warn" title={vNote.text}>
            {vNote.chip}
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
        {treeOrder(s.agents).map((a) => {
          const parent = a.parentId && a.parentId !== a.id ? byId.get(a.parentId) : undefined;
          return (
            <span
              key={a.id}
              className={`a ${a.status === "aborted" ? "done" : a.status}${a.kind === "fork" ? " fork" : ""}`}
              style={cssVar(FAMILY_COLOR[a.modelFamily])}
              title={`${a.description} · ${a.status}${parent ? ` · launched by ${parent.description}` : ""}`}
            />
          );
        })}
        <span className="mono cnt">
          {c.running} running · {c.done} done{c.failed ? ` · ${c.failed} failed` : ""}
        </span>
      </div>
      {/* The card stays short: the sentence only. The orchestrator page adds the tool name or question (waitSummary). */}
      {s.status === "waiting" && <div className="alert">{waitSummary(s).lead}</div>}
      {s.status === "stale" && (
        <div className="alert stale">
          {/* One child: .alert is a flex row, and its gap would otherwise open between every text run and span. */}
          <span>
            Last heartbeat <span className="mono">{fmtDur(sinceSeen)}</span> ago. Goes away in{" "}
            <span className="mono">{fmtCountdown((dropAtOf(s, config) - now) / 1000)}</span>.
          </span>
        </div>
      )}
      <div className="foot">
        <div className="mono">
          <span className="v" title={COST_HINT_SESSION}><Cost usd={s.costUsd} family={s.modelFamily} /> ·</span>{" "}
          <span className="v" title={TOKENS_HINT}>{fmtTok(sessionTokens(s))} tok ·</span>{" "}
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
