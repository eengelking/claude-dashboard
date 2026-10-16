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
  /** The Admin's activity-feed flag: false turns the agent and orchestrator Activity sections into a note. */
  activityFeedOn?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const agent = props.selected && props.selectedAgent ? props.selected.agents.find((a) => a.id === props.selectedAgent) : undefined;
  return (
    <aside className={`side${props.collapsed ? " collapsed" : ""}`} aria-label="Activity and agent detail">
      {props.onToggle && <PaneTab side="right" collapsed={!!props.collapsed} controls="podium-side-body" onToggle={props.onToggle} shortcut="]" />}
      <div id="podium-side-body" hidden={props.collapsed}>
      {props.selected && props.selectedAgent === ORCHESTRATOR_ROW ? (
        <OrchestratorDetail s={props.selected} now={props.now} onBack={props.onBack} activityFeedOn={props.activityFeedOn} />
      ) : agent && props.selected ? (
        <AgentDetail s={props.selected} a={agent} now={props.now} onBack={props.onBack} onAgent={props.onAgent} activityFeedOn={props.activityFeedOn} />
      ) : (
        <>
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
