import { fmtDur } from "../format";
import type { LifecycleConfig, SessionView } from "../types";
import type { AgentSortKey } from "../logic";
import { AgentTree, type AgentSort } from "./AgentTree";
import { BlowoutCallout } from "./BlowoutCallout";
import { FactsBar } from "./FactsBar";
import { FocusHeader } from "./FocusHeader";
import { PlanPanel } from "./PlanPanel";
import { waitText } from "./SessionCard";

export function FocusView(props: {
  s: SessionView;
  now: number;
  config: LifecycleConfig;
  sort: AgentSort;
  onSort: (key: AgentSortKey | null) => void;
  selectedAgent: string | null;
  flashAgent: string | null;
  onAgent: (id: string) => void;
}) {
  const { s, now, config } = props;
  return (
    <>
      <FocusHeader s={s} now={now} />
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
            been closed without a clean exit. It is dropped from the fleet at {fmtDur((config.staleAfterMs + config.dropAfterMs) / 1000)}.
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
