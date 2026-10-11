import { fmtClock } from "../format";
import { EVENT_CAP } from "../store";
import type { ActivityView, SessionView } from "../types";
import { cssVar, FAMILY_COLOR } from "./Chips";
import { IconJump } from "./Icons";

export const PAGE = 12;

export function hintFor(e: ActivityView, live: SessionView | undefined): string {
  if (!live) return "Session ended";
  if (e.kind === "fail") return "Show root cause";
  if (e.kind === "blow") return "Show context history";
  if (e.agentId && live.agents.some((a) => a.id === e.agentId)) return "Open agent";
  return "Open orchestrator";
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
            const cls = [props.isNew(e.id) && "new", e.kind === "fail" && "bad", e.kind === "blow" && "blowev", !live && "gone", props.selectedAgent && e.agentId === props.selectedAgent && "cur"]
              .filter(Boolean)
              .join(" ");
            const hint = hintFor(e, live);
            const inner = (
              <>
                <time className="mono">{fmtClock(e.t)}</time>
                <i className="ed" style={cssVar(FAMILY_COLOR[e.modelFamily])} aria-hidden="true" />
                <div className="tt">
                  {!props.selected && <b>{e.sessionName} </b>}
                  {e.text}
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
