import type { ModelFamily } from "../types";
import { ModelChip } from "./Chips";

/** What the squares on a card and in the agent tree mean. It sits under the middle column, outside the scrolling main, so it never moves with the content. */
export function Legend() {
  const fams: ModelFamily[] = ["opus", "sonnet", "haiku", "fable"];
  return (
    <footer className="legend" aria-label="Legend">
      <span>
        <i className="a" />
        subagent (blank slate)
      </span>
      <span>
        <i className="a f" />
        fork (keeps context)
      </span>
      <span>
        <i className="a q" />
        queued
      </span>
      <span>
        <i className="a d" />
        done
      </span>
      <span>
        Square color is the model:{" "}
        {fams.map((f) => (
          <ModelChip key={f} family={f} />
        ))}
      </span>
    </footer>
  );
}
