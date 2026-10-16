import type { ReactNode } from "react";
import { fmtCountdown, fmtDur } from "../format";
import { delegateText, dropAtOf } from "../logic";
import type { AgentView, LifecycleConfig, SessionView } from "../types";
import { backgroundDetail, backgroundTitle } from "../waiting";
import { StateIcon, type StateKind } from "./Chips";
import { bandLine, waitSummary } from "./SessionCard";
import { RespondButton } from "./Respond";
import { respondGate } from "../respond";
import { useRespond } from "../useRespond";

/**
 * The last row of the summary surface: the same states, shapes, sentences and tints as the card's band, plus one detail
 * line. Failed agents do not change it (SPEC has no failed band state). Remove now is its own element laid over the right
 * end, so a changing countdown cannot move it (#144, #165).
 */
export function StatusBand({
  s,
  kind,
  delegates,
  now,
  config,
  onRemove,
}: {
  s: SessionView;
  kind: StateKind;
  delegates: readonly AgentView[];
  now: number;
  config: LifecycleConfig;
  onRemove?: (id: string) => void;
}) {
  const hot = kind === "waiting" || kind === "stale";
  const respond = useRespond();
  const canRespond = !!respond && respondGate(s, respond.me, respond.flagsOn).show !== "none";
  const sinceSeen = Math.max(0, (now - s.lastSeenAt) / 1000);
  let lead: ReactNode;
  let detail: string | null = null;
  let title: string | undefined;
  if (kind === "deleg") {
    lead = bandLine(s, kind, sinceSeen, now, config, delegates);
    detail = delegates.map((a) => a.description).join(", ");
    title = delegateText(delegates);
  } else if (kind === "stale") {
    lead = (
      <span className="bl">
        No heartbeat for <span className="mono">{fmtDur(sinceSeen)}</span>. Goes away in <span className="mono">{fmtCountdown((dropAtOf(s, config) - now) / 1000)}</span>.
      </span>
    );
    detail = "The session may have crashed or been closed without a clean exit.";
  } else {
    // The band's sentence is the card's own.
    lead = bandLine(s, kind, sinceSeen, now, config);
    if (kind === "waiting") {
      const w = waitSummary(s);
      // With Respond on the band, the terminal is no longer the only place to answer.
      detail = canRespond ? w.detail : w.detail ? `Answer in its terminal. ${w.detail}` : "Answer in its terminal.";
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
      {canRespond && <RespondButton s={s} />}
      {remove && (
        <button type="button" className="btn rm" onClick={() => remove(s.id)}>
          Remove now
        </button>
      )}
    </div>
  );
}
