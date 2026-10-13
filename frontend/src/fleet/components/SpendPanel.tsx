// "Spend today, by person" (or by group) in the right panel, as a bar chart or a table (issue #34).
// One series, so no legend: the title names it, each bar carries its value, and the table holds the same
// numbers. Bars are a neutral ink, never a hue, because hues mean model and status in Podium.
import { useState } from "react";
import { fmtUsd } from "../format";
import { sharePct, type GroupBy, type SpendRow } from "../people";
import { Monogram } from "./People";

export function SpendPanel(props: { rows: SpendRow[]; total: number; groupBy: GroupBy; view: "chart" | "table"; onView: (v: "chart" | "table") => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const byGroup = props.groupBy === "group";
  const title = byGroup ? "Spend today, by group" : "Spend today, by person";
  const max = props.rows.reduce((m, r) => Math.max(m, r.spend), 0);
  const live = props.rows.reduce((n, r) => n + r.sessions, 0);
  const hovered = props.rows.find((r) => r.key === hover) ?? null;
  const detail = (r: SpendRow) => `${r.name}: ${fmtUsd(r.spend)}, ${sharePct(r.spend, props.total)}% of ${fmtUsd(props.total)}`;
  return (
    <section className="spendp" aria-labelledby="podium-spend-title">
      <div className="sh">
        <h2 id="podium-spend-title">{title}</h2>
        <span className="seg" role="group" aria-label="Show spend as">
          <button type="button" aria-pressed={props.view === "chart"} onClick={() => props.onView("chart")}>
            Chart
          </button>
          <button type="button" aria-pressed={props.view === "table"} onClick={() => props.onView("table")}>
            Table
          </button>
        </span>
      </div>
      {!props.rows.length ? (
        <div className="note">Nothing spent yet today.</div>
      ) : props.view === "table" ? (
        <div className="tw">
          <table className="tv">
            <thead>
              <tr>
                <th scope="col">{byGroup ? "Group" : "Person"}</th>
                <th scope="col" className="n">
                  Live
                </th>
                <th scope="col" className="n">
                  Spend
                </th>
                <th scope="col" className="n">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  <td className="n mono">{r.sessions}</td>
                  <td className="n mono">{fmtUsd(r.spend)}</td>
                  <td className="n mono">{sharePct(r.spend, props.total)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="n mono">{live}</td>
                <td className="n mono">{fmtUsd(props.total)}</td>
                <td className="n mono">{props.total > 0 ? "100%" : "0%"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <>
          <ul className="hb" aria-label={title}>
            {props.rows.map((r) => (
              <li
                key={r.key}
                className={hover === r.key ? "on" : undefined}
                aria-label={detail(r)}
                onPointerEnter={() => setHover(r.key)}
                onPointerLeave={() => setHover((h) => (h === r.key ? null : h))}
              >
                <span className="lbl" aria-hidden="true">
                  <Monogram name={r.name} kind={r.kind} size="sm" />
                  <span>{r.name}</span>
                </span>
                <span className="trk" aria-hidden="true">
                  <i style={{ width: `${max > 0 ? Math.max(1.5, (r.spend / max) * 100) : 0}%` }} />
                </span>
                <span className="val mono" aria-hidden="true">
                  {fmtUsd(r.spend)}
                </span>
              </li>
            ))}
          </ul>
          <div className="readout mono" aria-hidden="true">
            {hovered ? detail(hovered) : `${fmtUsd(props.total)} in all`}
          </div>
        </>
      )}
      <div className="note">
        Each bar is one {byGroup ? "group" : "person"}, largest first, counting sessions that started today, live or ended. Estimated from tokens, not a bill.
      </div>
    </section>
  );
}
