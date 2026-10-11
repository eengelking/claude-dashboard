import type { ActivityView, SessionView } from "../types";
import { ActivityList } from "./ActivityList";
import { AgentDetail } from "./AgentDetail";

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
}) {
  const agent = props.selected && props.selectedAgent ? props.selected.agents.find((a) => a.id === props.selectedAgent) : undefined;
  return (
    <aside className="side" aria-label="Activity and agent detail">
      {agent && props.selected ? (
        <AgentDetail s={props.selected} a={agent} now={props.now} onBack={props.onBack} onAgent={props.onAgent} />
      ) : (
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
      )}
    </aside>
  );
}
