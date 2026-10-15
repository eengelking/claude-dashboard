// The Reporters tab (issue #142, mockup/podium-reporters.html): every machine that has reported to this server, kept after its
// sessions are deleted. The server works out each state from what it can see, and the page asks again every few seconds, so a
// reporter that stops moves from "Reporting" to "Silent" without a reload. "Silent" means nothing has arrived for a while; the
// server cannot tell a reporter that is turned off from one that cannot reach it.
import { useEffect, useState } from "react";
import { AdminError, query, type AdminApi, type ReporterDetail, type ReporterList, type ReporterRow, type ReporterSort, type ReporterState } from "./adminApi";
import { Pager } from "./Pager";
import { Panel, Section } from "./Page";
import { failText, useList } from "./useList";

export interface ReporterPaging {
  page: number;
  pageSize: number;
  q: string;
  state: "" | ReporterState;
  sort: ReporterSort;
  dir: 1 | -1;
}

/** How often the list asks the server again while the tab is open and visible. */
export const REFRESH_MS = 10_000;

const STATES: { id: ReporterState; name: string; def: string }[] = [
  { id: "reporting", name: "Reporting", def: "Heard from in the last 2 minutes." },
  { id: "idle", name: "Idle", def: "Last report between 2 minutes and 1 hour ago." },
  { id: "silent", name: "Silent", def: "Nothing for over 1 hour. It may be off, offline or blocked; the server cannot tell which." },
  { id: "restart", name: "Not since restart", def: "Known from before this server started, and not heard from since." },
];
const stateOf = (id: ReporterState) => STATES.find((s) => s.id === id)!;

const COMPAT: Record<ReporterRow["compat"], string> = {
  ok: "Supported",
  outdated: "Older than this server supports. Update the mod.",
  newer: "Newer than this server knows. Update Podium.",
  unknown: "There is no version to check.",
};

/** "3 h ago", counted from the server's clock so a wrong clock in the browser cannot skew it. */
export function ago(serverTime: number, t: number): string {
  const d = Math.max(0, serverTime - t);
  if (d < 15_000) return "just now";
  if (d < 60_000) return `${Math.round(d / 1000)} s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} days ago`;
}
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const time = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Asks again on an interval while the page is visible. */
function useRefresh(reload: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") reload();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload, enabled]);
}

function StateBadge({ id }: { id: ReporterState }) {
  const s = stateOf(id);
  return (
    <span className={`rstate ${id}`} title={s.def}>
      <span className={`rdot ${id}`} aria-hidden="true" />
      {s.name}
    </span>
  );
}

function Version({ r }: { r: ReporterRow }) {
  const flag = r.compat === "outdated" || r.compat === "newer";
  return (
    <span className={`compat ${r.compat}`} title={COMPAT[r.compat]}>
      {flag && <span aria-hidden="true">⚠ </span>}
      <span className="mono">{r.version}</span>
      {flag ? ` ${r.compat}` : r.compat === "unknown" ? " no mod" : ""}
    </span>
  );
}

export function ReportersTab(props: {
  api: AdminApi;
  paging: ReporterPaging;
  onPaging: (p: Partial<ReporterPaging>) => void;
  onCount: (n: number) => void;
  onLocked: () => void;
}) {
  const { api, paging, onPaging, onCount } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState(paging.q);
  const list = useList<ReporterList>(api, `/reporters${query({ page: paging.page, pageSize: paging.pageSize, q: paging.q, state: paging.state, sort: paging.sort, dir: paging.dir })}`, props.onLocked);
  useRefresh(list.reload, open === null);
  const total = list.data?.counts.all;
  useEffect(() => {
    if (total !== undefined) onCount(total);
  }, [total, onCount]);
  useEffect(() => {
    if (search === paging.q) return;
    const t = setTimeout(() => onPaging({ q: search, page: 1 }), 250);
    return () => clearTimeout(t);
  }, [search, paging.q, onPaging]);

  if (open !== null) return <Detail api={api} id={open} onBack={() => (setOpen(null), list.reload())} onLocked={props.onLocked} />;

  const data = list.data;
  const sortBy = (sort: ReporterSort) => onPaging({ sort, dir: paging.sort === sort ? (paging.dir === 1 ? -1 : 1) : 1, page: 1 });
  const th = (sort: ReporterSort, label: string, cls = "") => (
    <th className={cls} aria-sort={paging.sort === sort ? (paging.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="thbtn" onClick={() => sortBy(sort)}>
        {label}
        {paging.sort === sort ? (paging.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  return (
    <Section id="admin-reporters-h" title="Heard from">
      <Panel>
        <div className="states" role="group" aria-label="Filter by state">
          {[{ id: "" as const, name: "All reporters", n: data?.counts.all }, ...STATES.map((s) => ({ id: s.id, name: s.name, n: data?.counts[s.id] }))].map((s) => (
            <button key={s.id || "all"} type="button" className="sbtn" aria-pressed={paging.state === s.id} onClick={() => onPaging({ state: s.id, page: 1 })} title={s.id ? stateOf(s.id).def : undefined}>
              <span className="k">
                {s.id && <span className={`rdot ${s.id}`} aria-hidden="true" />}
                {s.name}
              </span>
              <span className="v mono">{s.n ?? "–"}</span>
            </button>
          ))}
        </div>
        <div className="tool">
          <div className="f grow inline">
            <label htmlFor="reporters-search">Search reporters</label>
            <input className="field" id="reporters-search" type="search" placeholder="Machine, person, address or version" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {list.error && (
          <div className="err" role="alert">
            Could not load the reporters ({list.error}).
          </div>
        )}
        {data && data.rows.length === 0 ? (
          <div className="empty">{data.counts.all ? "No reporter matches. Clear the search or pick another state." : "No reporter has connected yet. Install podium-reporter and point it at this server."}</div>
        ) : (
          data && (
            <div className="tw2 scroll" tabIndex={0} aria-label="Reporters">
              <table className="ptab">
                <thead>
                  <tr>
                    {th("state", "State")}
                    {th("name", "Machine")}
                    {th("who", "Person")}
                    {th("ver", "Reporter version")}
                    {th("last", "Last report")}
                    {th("sessions", "Sessions", "n")}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.key} className="rw" onClick={() => setOpen(r.key)}>
                      <td>
                        <StateBadge id={r.state} />
                      </td>
                      <td>
                        <button type="button" className="rname" onClick={(e) => (e.stopPropagation(), setOpen(r.key))} aria-label={`Open details for ${r.name}`}>
                          {r.name}
                        </button>
                        <span className="sub mono">{r.key.startsWith("addr:") || r.key.startsWith("hooks:") ? `no machine id, matched by address ${r.key.slice(r.key.indexOf(":") + 1)}` : r.key}</span>
                      </td>
                      <td>{r.who}</td>
                      <td>
                        <Version r={r} />
                      </td>
                      <td className="mono muted nowrap">{ago(data.serverTime, r.lastSeenAt)}</td>
                      <td className="n mono">
                        {r.sessions}
                        {r.live > 0 && <span className="hint"> · {r.live} live</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {data && data.total > 0 && <Pager id="reporters" page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => onPaging({ page: n })} onSize={(n) => onPaging({ pageSize: n, page: 1 })} />}
        <div className="rnote">
          <b>Silent</b> means the server has not heard from this reporter for a while. It does not mean the reporter is turned off: Podium can only see what arrives.
        </div>
      </Panel>
    </Section>
  );
}

function Detail(props: { api: AdminApi; id: string; onBack: () => void; onLocked: () => void }) {
  const { api, id } = props;
  const path = `/reporters/${encodeURIComponent(id)}`;
  const one = useList<ReporterDetail>(api, path, props.onLocked);
  useRefresh(one.reload);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");
  const d = one.data;

  const remove = async () => {
    try {
      await api("DELETE", path);
      props.onBack();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) props.onLocked();
      else if (e instanceof AdminError && e.status === 404) props.onBack();
      else setErr(failText(e));
    }
  };

  const back = (
    <button type="button" className="back" onClick={props.onBack}>
      <span aria-hidden="true">‹</span> All reporters
    </button>
  );
  if (!d) {
    return (
      <Panel>
        {back}
        {one.error ? (
          <div className="empty">{one.error === "unknown reporter" ? "That reporter is no longer on the list." : `Could not load this reporter (${one.error}).`}</div>
        ) : (
          <div className="empty">Loading…</div>
        )}
      </Panel>
    );
  }
  const kv = (rows: [string, React.ReactNode][]) => (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} className="kvrow">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <Panel>
      {back}
      <div className="dhead">
        <h2>
          {d.name} <StateBadge id={d.state} />
        </h2>
        {confirm ? (
          <div className="confirm">
            Remove {d.name} from the list? It comes back if it reports again. Its sessions are not touched.
            <button type="button" className="btn sm dng" onClick={() => void remove()}>
              Remove reporter
            </button>
            <button type="button" className="btn sm" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" className="btn sm dng" onClick={() => setConfirm(true)}>
            Remove from list
          </button>
        )}
      </div>
      {err && (
        <div className="err" role="alert">
          {err}
        </div>
      )}
      <div className="dgrid">
        <section className="dsec" aria-labelledby="rep-h1">
          <h3 id="rep-h1">Reporter</h3>
          {kv([
            ["Version", <span key="v" className="mono">{d.version}</span>],
            ["Compatibility", <span key="c" className={`compat ${d.compat}`}>{COMPAT[d.compat]}</span>],
            ["Claude Code", <span key="e" className="mono">{d.engineVersion ?? "not reported"}</span>],
            ["First seen", <>{day(d.firstSeenAt)} <span className="hint">({ago(d.serverTime, d.firstSeenAt)})</span></>],
            ["Last report", ago(d.serverTime, d.lastSeenAt)],
            ["Sessions seen", <span key="s" className="tt" title="Totals outlive the sessions themselves, which are deleted 30 days after they end."><span className="mono">{d.sessions}</span> in total, {d.live} running now</span>],
          ])}
        </section>
        <section className="dsec" aria-labelledby="rep-h2">
          <h3 id="rep-h2">Where it comes from</h3>
          {kv([
            ["Machine", d.name],
            ["Machine id", d.machineId ? <span key="m" className="mono">{d.machineId}</span> : <span key="m" className="tt" title="The reporter has no user name set, so it sends no machine id and is matched by source address.">Not sent</span>],
            ["Source address", <span key="a" className="mono">{d.source ?? "unknown"}</span>],
            ["Person", d.who],
            ["Token", d.credential ? <span key="t" className="mono tt" title="The token's key id, which finds the person. The secret part is never shown or kept.">{d.credential}</span> : "none"],
          ])}
        </section>
        <div className="dwide">
          <h3>Recent sessions</h3>
          {d.recent.length ? (
            <div className="tw2">
              <table className="ptab">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>State</th>
                    <th>Last report</th>
                    <th className="n">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((s) => (
                    <tr key={s.id}>
                      <td className="strong">{s.name}</td>
                      <td>{s.status}</td>
                      <td className="mono muted">{ago(d.serverTime, s.lastSeenAt)}</td>
                      <td className="n mono">{s.costUsd === null ? "–" : `$${s.costUsd.toFixed(2)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <span className="tt" title="Sessions are deleted 30 days after they end.">
                No sessions left.
              </span>
            </div>
          )}
        </div>
        <div className="dwide">
          <h3>Reports the server turned away</h3>
          {d.rejected.length ? (
            <ul className="rej">
              {d.rejected.map((x, i) => (
                <li key={`${x.t}-${i}`}>
                  <span className="mono muted">{time(x.t)}</span>
                  <span className="bad">{x.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">None lately.</div>
          )}
        </div>
      </div>
    </Panel>
  );
}
