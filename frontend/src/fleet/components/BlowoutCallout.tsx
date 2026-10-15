import type { SessionView } from "../types";
import { familyName } from "../logic";
import { IconOrch } from "./Icons";

/** The blowout detail that opens from the Blowouts cell, between the header and the facts: the sentence and each loop that hit it. */
export function BlowoutCallout({ s, onAgent, id }: { s: SessionView; onAgent: (id: string) => void; id: string }) {
  const b = s.blowouts;
  if (!b.total) return null;
  const l2 = b.level === 2;
  const hits = s.agents.filter((a) => a.blowouts > 0).sort((x, y) => y.blowouts - x.blowouts);
  return (
    <div className={`bdet${l2 ? " l2" : " l1"}`} id={id} role="note">
      <b>{l2 ? "Repeated context blowouts. This session is likely losing context." : "A context window was exceeded."}</b> When the window fills,
      earlier work is compacted away and the model can start inventing details it no longer remembers.{" "}
      {l2 ? "Split the task into smaller steps, or restart the affected agents with a narrower prompt." : "One more and this session is flagged."}
      <ul>
        {b.orchestrator > 0 && (
          <li>
            <IconOrch /> Orchestrator: <b>{b.orchestrator}×</b>
          </li>
        )}
        {hits.map((a) => (
          <li key={a.id}>
            <button type="button" className="lk" onClick={() => onAgent(a.id)}>
              {a.description}
            </button>{" "}
            · {familyName(a.modelFamily, a.model)} · <b>{a.blowouts}×</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
