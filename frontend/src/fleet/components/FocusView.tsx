import { useId, useState } from "react";
import type { AgentSortKey } from "../logic";
import type { LifecycleConfig, SessionView } from "../types";
import { AgentTree, type AgentSort } from "./AgentTree";
import { BlowoutCallout } from "./BlowoutCallout";
import { FactsBar } from "./FactsBar";
import { FocusHeader } from "./FocusHeader";
import { PlanPanel, type PlanTab } from "./PlanPanel";
import { StatusBand } from "./StatusBand";

/**
 * The orchestrator page (#165): one bordered surface of fixed layers, then the work. Header, the blowout detail when it is
 * opened, the facts, and the status band as the last row; then the plan and the agent tree side by side.
 */
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
  // The Files tab needs room for paths, so the left column grows while it is selected.
  const [tab, setTab] = useState<PlanTab>("plan");
  // Which session's blowout detail is open. Closed by default, and closed again for another session.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const detailId = useId();
  const hasBlowouts = s.blowouts.total > 0;
  const open = hasBlowouts && openFor === s.id;
  return (
    <div className="op">
      <div className={`osum${s.blowouts.level === 2 ? " risk" : ""}`}>
        <FocusHeader s={s} now={now} />
        {open && <BlowoutCallout s={s} onAgent={props.onAgent} id={detailId} />}
        <FactsBar s={s} now={now} onAgent={props.onAgent} blow={{ open, onToggle: () => setOpenFor(open ? null : s.id), controls: detailId }} />
        <StatusBand s={s} now={now} config={config} onRemove={props.onRemove} />
      </div>
      <div className={`two${tab === "files" ? " wide" : ""}`}>
        <PlanPanel s={s} onTab={setTab} />
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
    </div>
  );
}
