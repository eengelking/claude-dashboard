import type { ReactNode } from "react";
import { fmtCountdown, fmtDur } from "../format";
import { delegateText, dropAtOf, ORCHESTRATOR_ROW, waitingOnByRow } from "../logic";
import type { LifecycleConfig, SessionView } from "../types";
import { backgroundDetail, backgroundTitle } from "../waiting";
import { cardKind, StateIcon, type StateKind } from "./Chips";
import { bandLine, waitSummary } from "./SessionCard";

/** The card's states plus delegating, which SPEC 8.1 (#98) shows on this page and not on the cards. */
export function pageKind(s: SessionView): StateKind {
  const kind = cardKind(s);
  if (kind === "running" && waitingOnByRow(s).get(ORCHESTRATOR_ROW)?.length) return "deleg";
  return kind;
}

/**
 * The last row of the summary surface: the same states, shapes, sentences and tints as the card's band, plus one detail
 * line. Failed agents do not change it (SPEC has no failed band state). Remove now is its own element laid over the right
 * end, so a changing countdown cannot move it (#144, #165).
 */
export function StatusBand({ s, now, config, onRemove }: { s: SessionView; now: number; config: LifecycleConfig; onRemove?: (id: string) => void }) {
  const kind = pageKind(s);
  const hot = kind === "waiting" || kind === "stale";
  const sinceSeen = Math.max(0, (now - s.lastSeenAt) / 1000);
  let lead: ReactNode;
  let detail: string | null = null;
  let title: string | undefined;
  if (kind === "deleg") {
    const kids = waitingOnByRow(s).get(ORCHESTRATOR_ROW) ?? [];
    lead = <span className="bl">{`Delegating to ${kids.length} agent${kids.length === 1 ? "" : "s"}.`}</span>;
    detail = kids.map((a) => a.description).join(", ");
    title = delegateText(kids);
  } else if (kind === "stale") {
    lead = (
      <span className="bl">
        No heartbeat for <span className="mono">{fmtDur(sinceSeen)}</span>. Goes away in <span className="mono">{fmtCountdown((dropAtOf(s, config) - now) / 1000)}</span>.
      </span>
    );
    detail = "The session may have crashed or been closed without a clean exit.";
  } else {
    // kind is a CardKind here: the band's sentence is the card's own.
    lead = bandLine(s, kind, sinceSeen, now, config);
    if (kind === "waiting") {
      const w = waitSummary(s);
      detail = w.detail ? `Answer in its terminal. ${w.detail}` : "Answer in its terminal.";
    } else if (kind === "bg" && s.background) {
      detail = backgroundDetail(s.background);
      title = backgroundTitle(s.background);
    }
  }
  const remove = kind === "stale" && onRemove ? onRemove : undefined;
  return (
    <div className={`band ${kind}${hot ? " hot" : ""}${remove ? " has-rm" : ""}`} title={title}>
      <span className="bi">
        <StateIcon kind={kind} />
      </span>
      <span className="bt">
        {lead}
        {detail && (
          <span className="bd" title={detail}>
            {detail}
          </span>
        )}
      </span>
      {remove && (
        <button type="button" className="btn rm" onClick={() => remove(s.id)}>
          Remove now
        </button>
      )}
    </div>
  );
}
