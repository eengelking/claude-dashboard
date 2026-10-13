import { fmtClock } from "../format";
import { EVENT_CAP } from "../store";
import type { ActivityView, SessionView } from "../types";
import { cssVar, FAMILY_COLOR } from "./Chips";
import { IconJump } from "./Icons";
import { readableEvent } from "../eventText";
import { parentOf } from "../logic";
import { parseWaitEvent, waitLead } from "../waiting";

export const PAGE = 12;

export function hintFor(e: ActivityView, live: SessionView | undefined): string {
  if (!live) return "Session ended";
  if (e.kind === "fail") return "Show root cause";
  if (e.kind === "blow") return "Show context history";
  if (e.agentId && live.agents.some((a) => a.id === e.agentId)) return "Open agent";
  return "Open orchestrator";
}

/** For a launch by another agent (not the orchestrator): that agent's task, so the feed names the real parent (#101). */
export function launchedBy(e: ActivityView, live: SessionView | undefined): string | null {
  if (e.kind !== "spawn" || !e.agentId || !live) return null;
  const a = live.agents.find((x) => x.id === e.agentId);
  return a ? (parentOf(live.agents, a)?.description ?? null) : null;
}

export function ActivityList(props: {
  events: ActivityView[];
  sessions: Record<string, SessionView>;
  gone: Record<string, unknown>;
  selected: SessionView | null;
  selectedAgent: string | null;
  shown: number;
  onShown: (n: number) => void;
  isNew: (id: string) => boolean;
  onOpen: (e: ActivityView) => void;
}) {
  const list = props.selected ? props.events.filter((e) => e.sessionId === props.selected!.id) : props.events;
  const shown = list.slice(0, props.shown);
  // Newest event time per session, built once so each wait row is an O(1) lookup instead of a scan of every event.
  const latest: Record<string, number> = {};
  for (const o of props.events) if (!(o.t <= (latest[o.sessionId] ?? -Infinity))) latest[o.sessionId] = o.t;
  return (
    <>
      <div className="sh">
        <h2>Activity · {props.selected ? props.selected.name : "all orchestrators"}</h2>
        <span className="kpi-cap">newest first</span>
      </div>
      <ul className="ev">
        {shown.length ? (
          shown.map((e) => {
            const live = props.gone[e.sessionId] ? undefined : props.sessions[e.sessionId];
            const wait = e.kind === "wait" ? parseWaitEvent(e.text) : null;
            // A wait stays yellow only while it is the session's latest news and the session is still waiting.
            const plain = wait ? null : readableEvent(e);
            const open = !!wait && live?.status === "waiting" && !(latest[e.sessionId] > e.t);
            const cls = [props.isNew(e.id) && "new", wait && (open ? "w" : "ans"), e.kind === "fail" && "bad", e.kind === "blow" && "blowev", !live && "gone", props.selectedAgent && e.agentId === props.selectedAgent && "cur"]
              .filter(Boolean)
              .join(" ");
            const hint = hintFor(e, live);
            const by = launchedBy(e, live);
            const inner = (
              <>
                <time className="mono">{fmtClock(e.t)}</time>
                <i className="ed" style={cssVar(FAMILY_COLOR[e.modelFamily])} aria-hidden="true" />
                <div className="tt">
                  {!props.selected && <b>{e.sessionName} </b>}
                  {wait ? (
                    <>
                      <span className="lead">{waitLead(wait.reason, wait.tool, !open)}</span>
                      {wait.tool && <span className="tool">{wait.tool}</span>}
                    </>
                  ) : plain ? (
                    <>
                      {plain.text}
                      {plain.tool && <span className="tool">{plain.tool}</span>}
                    </>
                  ) : (
                    e.text
                  )}
                  {by && <span className="by"> · launched by {by}</span>}
                  <span className="go">
                    {live && <IconJump />}
                    {hint}
                  </span>
                </div>
              </>
            );
            return (
              <li key={e.id} className={cls || undefined}>
                {live ? (
                  <button type="button" className="evb" onClick={() => props.onOpen(e)}>
                    {inner}
                  </button>
                ) : (
                  <div className="evb">{inner}</div>
                )}
              </li>
            );
          })
        ) : (
          <li>
            <div className="evb">
              <span />
              <span />
              <div className="tt" style={{ color: "var(--muted)" }}>
                {props.selected ? "Nothing yet for this orchestrator." : "No activity yet."}
              </div>
            </div>
          </li>
        )}
      </ul>
      <div className="more">
        <span>
          Showing {shown.length} of {list.length}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          {props.shown > PAGE && (
            <button type="button" className="btn" onClick={() => props.onShown(PAGE)}>
              Show fewer
            </button>
          )}
          {list.length > props.shown && (
            <button type="button" className="btn" onClick={() => props.onShown(props.shown + PAGE)}>
              Show {Math.min(PAGE, list.length - props.shown)} more
            </button>
          )}
        </span>
      </div>
      <div className="foot-note">Only the latest {EVENT_CAP} events are kept in memory.</div>
    </>
  );
}
