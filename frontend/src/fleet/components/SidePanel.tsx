import type { ReactNode } from "react";
import type { ActivityView, SessionView } from "../types";
import { ORCHESTRATOR_ROW } from "../logic";
import { ActivityList } from "./ActivityList";
import { AgentDetail } from "./AgentDetail";
import { OrchestratorDetail } from "./OrchestratorDetail";
import { PaneTab } from "./PaneTab";

export function SidePanel(props: {
  events: ActivityView[];
  sessions: Record<string, SessionView>;
  gone: Record<string, unknown>;
  selected: SessionView | null;
  selectedAgent: string | null;
  shown: number;
  onShown: (n: number) => void;
  isNew: (id: string) => boolean;
  onOpenEvent: (e: ActivityView) => void;
  onAgent: (id: string) => void;
  onBack: () => void;
  now: number;
  collapsed?: boolean;
  onToggle?: () => void;
  /** The people view's spend chart, shown above the activity list on the wall. */
  spend?: ReactNode;
}) {
  const agent = props.selected && props.selectedAgent ? props.selected.agents.find((a) => a.id === props.selectedAgent) : undefined;
  return (
    <aside className={`side${props.collapsed ? " collapsed" : ""}`} aria-label="Activity and agent detail">
      {props.onToggle && <PaneTab side="right" collapsed={!!props.collapsed} controls="podium-side-body" onToggle={props.onToggle} shortcut="]" />}
      <div id="podium-side-body" hidden={props.collapsed}>
      {props.selected && props.selectedAgent === ORCHESTRATOR_ROW ? (
        <OrchestratorDetail s={props.selected} now={props.now} onBack={props.onBack} />
      ) : agent && props.selected ? (
        <AgentDetail s={props.selected} a={agent} now={props.now} onBack={props.onBack} onAgent={props.onAgent} />
      ) : (
        <>
        {props.spend}
        <ActivityList
          events={props.events}
          sessions={props.sessions}
          gone={props.gone}
          selected={props.selected}
          selectedAgent={props.selectedAgent}
          shown={props.shown}
          onShown={props.onShown}
          isNew={props.isNew}
          onOpen={props.onOpenEvent}
        />
        </>
      )}
      </div>
    </aside>
  );
}
