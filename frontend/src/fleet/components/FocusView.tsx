import { fmtCountdown, fmtDur } from "../format";
import type { LifecycleConfig, SessionView } from "../types";
import { dropAtOf, type AgentSortKey } from "../logic";
import { AgentTree, type AgentSort } from "./AgentTree";
import { BlowoutCallout } from "./BlowoutCallout";
import { FactsBar } from "./FactsBar";
import { FocusHeader } from "./FocusHeader";
import { PlanPanel } from "./PlanPanel";
import { HOOKS_NOTE, waitText } from "./SessionCard";

export function FocusView(props: {
  s: SessionView;
  now: number;
  config: LifecycleConfig;
  sort: AgentSort;
  onSort: (key: AgentSortKey | null) => void;
  selectedAgent: string | null;
  flashAgent: string | null;
  onAgent: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const { s, now, config } = props;
  return (
    <>
      <FocusHeader s={s} now={now} />
      {s.reporter === "hooks" && (
        <div className="callout" role="note">
          <div>{HOOKS_NOTE} Load the mod with <code>claude --plugin-dir mod/podium-reporter</code> for the full view.</div>
        </div>
      )}
      <BlowoutCallout s={s} onAgent={props.onAgent} />
      {s.status === "waiting" && (
        <div className="card notice" style={{ cursor: "default" }}>
          <div className="alert" style={{ margin: 0 }}>
            {waitText(s)} This orchestrator is paused until you answer in its terminal.
          </div>
        </div>
      )}
      {s.status === "stale" && (
        <div className="card notice" style={{ cursor: "default" }}>
          <div className="alert stale" style={{ margin: 0 }}>
            No heartbeat for <span className="mono">{fmtDur(Math.max(0, (now - s.lastSeenAt) / 1000))}</span>. The session may have crashed or
            been closed without a clean exit. It goes away in{" "}
            <span className="mono">{fmtCountdown((dropAtOf(s, config) - now) / 1000)}</span>
            {props.onRemove ? ", or you can remove it now." : "."}
            {props.onRemove && (
              <button type="button" className="btn remove-inline" onClick={() => props.onRemove?.(s.id)}>
                Remove now
              </button>
            )}
          </div>
        </div>
      )}
      <FactsBar s={s} now={now} onAgent={props.onAgent} />
      <div className="two">
        <PlanPanel plan={s.plan} />
        <AgentTree
          s={s}
          now={now}
          sort={props.sort}
          onSort={props.onSort}
          selectedAgent={props.selectedAgent}
          flashAgent={props.flashAgent}
          onSelect={props.onAgent}
        />
      </div>
    </>
  );
}
