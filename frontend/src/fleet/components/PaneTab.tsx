/** The edge button of a collapsible pane: collapses it while open, and is the 24 px tab that opens it again. */
export function PaneTab(props: { side: "left" | "right"; collapsed: boolean; controls: string; onToggle: () => void; shortcut: string }) {
  const name = `${props.side} pane`;
  // The arrow points the way the pane will move: toward its edge to close, away from it to open.
  const toward = (props.side === "left") !== props.collapsed;
  return (
    <button
      type="button"
      className={`pane-tab pane-tab-${props.side}`}
      aria-expanded={!props.collapsed}
      aria-controls={props.controls}
      aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${name}`}
      title={`${props.collapsed ? "Expand" : "Collapse"} the ${name} (${props.shortcut})`}
      onClick={props.onToggle}
    >
      <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
        <path d={toward ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
      </svg>
    </button>
  );
}
