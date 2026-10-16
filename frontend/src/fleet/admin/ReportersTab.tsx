// The Reporters tab (issue #142, mockup/podium-reporters.html): every machine that has reported to this server, kept after its
// sessions are deleted. The server works out each state from what it can see, and the page asks again every few seconds, so a
// reporter that stops moves from "Reporting" to "Silent" without a reload. "Silent" means nothing has arrived for a while; the
// server cannot tell a reporter that is turned off from one that cannot reach it.
import { useEffect, useState } from "react";
import { AdminError, query, type AdminApi, type IgnoreRule, type RemoveBody, type ReporterDetail, type ReporterList, type ReporterRow, type ReporterSort, type ReporterState } from "./adminApi";
import { Pager } from "./Pager";
import { Panel, Section } from "./Page";
import { failText, useList } from "./useList";

export interface ReporterPaging {
  page: number;
  pageSize: number;
  q: string;
  state: "" | ReporterState;
  /** Only the reporters that use the admin secret. */
  admin: boolean;
  sort: ReporterSort;
  dir: 1 | -1;
}

/** How often the list asks the server again while the tab is open and visible. */
export const REFRESH_MS = 10_000;

const STATES: { id: ReporterState; name: string; def: string }[] = [
  { id: "reporting", name: "Reporting", def: "Heard from in the last 2 minutes." },
  { id: "idle", name: "Idle", def: "Last report between 2 minutes and 1 hour ago." },
  { id: "silent", name: "Silent", def: "Silent means the server has not heard from this reporter for a while. It does not mean the reporter is turned off: Podium can only see what arrives." },
  { id: "restart", name: "Not since restart", def: "Not since restart is what every reporter reads after this server restarts, until it reports again. Most rows show it for a short while after a restart; it does not mean they stopped." },
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

/** What this row's state means for this row: the general definition plus the times behind it. */
export function stateDetail(r: Pick<ReporterRow, "state" | "lastSeenAt">, serverTime: number, serverStartedAt: number): string {
  const s = stateOf(r.state);
  const heard = `Last heard ${ago(serverTime, r.lastSeenAt)} (${time(r.lastSeenAt)}).`;
  if (r.state === "restart") {
    return `${s.def} ${heard} This server started ${ago(serverTime, serverStartedAt)} (${time(serverStartedAt)}).`;
  }
  return `${s.def} ${heard}`;
}

/** Why a reporter has the name it has, when it sends none. */
export function nameDetail(r: Pick<ReporterRow, "name" | "named" | "key">): string | undefined {
  if (r.named || r.key.startsWith("hooks:")) return undefined;
  const addr = r.key.startsWith("addr:") ? r.key.slice(5) : null;
  return `No name is set on this reporter, so it is shown by its newest project, or its address. Set the userName option in podium-reporter to name it.${addr ? ` Until then it is matched by session, or by source address ${addr}.` : ""}`;
}

const IGNORE_HINT = "Ignore… asks what to ignore first: this reporter only, everything from its address, or every reporter on its version. Nothing happens until you confirm.";
const REMOVE_HINT = "Remove from list takes the row away and nothing else: the sessions stay, and the reporter comes back the next time it reports. To keep one off the list, ignore it. That turns its reports away.";

const ADMIN_HINT =
  "This reporter sends the admin secret instead of a token made for one person. Anyone holding the secret can report as anyone, and its sessions belong to no one. Make a token for the person in Admin > People, then enter it, and their name, in the reporter's options.";

function WarnIcon() {
  return (
    <svg className="wicon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.2L14.4 13H1.6L8 2.2z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.4v.1" />
    </svg>
  );
}

/** The token a reporter uses. The admin secret is a warning, always: an icon and words, focusable, with its reason. */
function Token({ r }: { r: Pick<ReporterRow, "adminSecret" | "credential"> }) {
  if (r.adminSecret) {
    return (
      <span className="admsec" tabIndex={0} title={ADMIN_HINT} aria-label={`Admin secret. ${ADMIN_HINT}`}>
        <WarnIcon />
        Admin secret
      </span>
    );
  }
  return r.credential ? <span className="tokid mono">{r.credential}</span> : <span className="tokid">none</span>;
}

/** A hover and keyboard-focus note: the same text as the title and as a line a screen reader reads. */
function StateBadge({ r, serverTime, serverStartedAt }: { r: Pick<ReporterRow, "state" | "lastSeenAt">; serverTime: number; serverStartedAt: number }) {
  const s = stateOf(r.state);
  const text = stateDetail(r, serverTime, serverStartedAt);
  return (
    <span className={`rstate ${r.state}`} title={text} tabIndex={0} aria-label={text}>
      <span className={`rdot ${r.state}`} aria-hidden="true" />
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
  // Issue #167: the rows ticked, whether "all that match" is ticked, and a removal waiting for its confirmation.
  const [sel, setSel] = useState<string[]>([]);
  const [selAll, setSelAll] = useState(false);
  const [pending, setPending] = useState<{ count: number; body: RemoveBody } | null>(null);
  const [err, setErr] = useState("");
  const rules = useList<{ rules: IgnoreRule[] }>(api, "/reporters/ignores", props.onLocked);
  const list = useList<ReporterList>(api, `/reporters${query({ page: paging.page, pageSize: paging.pageSize, q: paging.q, state: paging.state, sort: paging.sort, dir: paging.dir, admin: paging.admin ? 1 : "" })}`, props.onLocked);
  useRefresh(list.reload, open === null);
  const total = list.data?.counts.all;
  useEffect(() => {
    if (total !== undefined) onCount(total);
  }, [total, onCount]);
  // A different filter is a different set of matches.
  useEffect(() => {
    setSelAll(false);
    setPending(null);
  }, [paging.q, paging.state, paging.admin]);
  useEffect(() => {
    if (search === paging.q) return;
    const t = setTimeout(() => onPaging({ q: search, page: 1 }), 250);
    return () => clearTimeout(t);
  }, [search, paging.q, onPaging]);

  if (open !== null) return <Detail api={api} id={open} onBack={() => (setOpen(null), list.reload())} onLocked={props.onLocked} />;

  const data = list.data;
  const filterOf = () => ({ ...(paging.q ? { q: paging.q } : {}), ...(paging.state ? { state: paging.state } : {}), ...(paging.admin ? { admin: true } : {}) });
  const removePending = async () => {
    if (!pending) return;
    try {
      await api("POST", "/reporters/remove", pending.body);
      setSel([]);
      setSelAll(false);
      setPending(null);
      setErr("");
      list.reload();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) props.onLocked();
      else setErr(failText(e));
    }
  };
  const rows = data?.rows ?? [];
  const pageAllSelected = rows.length > 0 && rows.every((r) => sel.includes(r.key));
  const nSel = selAll && data ? data.total : sel.length;
  const plural = (n: number) => `${n} ${n === 1 ? "reporter" : "reporters"}`;
  const toggle = (key: string, on: boolean) => {
    setPending(null);
    // Unticking a row while "all that match" is on keeps the other rows on this page ticked; the rest of the matches are let go.
    setSel((cur) => (selAll ? rows.map((r) => r.key).filter((k) => k !== key) : on ? [...cur, key] : cur.filter((k) => k !== key)));
    setSelAll(false);
  };
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
    <>
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
        {(data?.adminSecret ?? 0) > 0 && (
          <div className="warnbar" role="status" aria-label="Reporters using the admin secret">
            <WarnIcon />
            <div className="tx">
              <b>
                {data!.adminSecret} {data!.adminSecret === 1 ? "reporter uses" : "reporters use"} the admin secret.
              </b>{" "}
              They should each use a token made for one person, so their sessions have an owner and the admin secret stays private.
            </div>
            <button type="button" className="btn sm" aria-pressed={paging.admin} onClick={() => onPaging({ admin: !paging.admin, page: 1 })}>
              {paging.admin ? "Show all reporters" : "Show only these"}
            </button>
          </div>
        )}
        <div className="tool">
          <div className="f grow inline">
            <label htmlFor="reporters-search">Search reporters</label>
            <input className="field" id="reporters-search" type="search" placeholder="Machine, person, address or version" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {paging.state && data && data.counts[paging.state] > 0 && (
            <button type="button" className="btn sm dng" onClick={() => setPending({ count: data.counts[paging.state as ReporterState], body: { match: { state: paging.state as ReporterState } } })}>
              Remove all {stateOf(paging.state as ReporterState).name} ({data.counts[paging.state]})
            </button>
          )}
        </div>
        {pending && (
          <div className="selbar" role="group" aria-label="Confirm removal">
            <span>Remove {plural(pending.count)} from the list? They come back if they report again, unless ignored. Their sessions are not touched.</span>
            <span className="grow" />
            <button type="button" className="btn sm dng" onClick={() => void removePending()}>
              Remove {plural(pending.count)}
            </button>
            <button type="button" className="btn sm" onClick={() => setPending(null)}>
              Keep them
            </button>
          </div>
        )}
        {!pending && nSel === 0 && (
          <div className="selbar idle" aria-hidden="true">
            Tick reporters to remove many at once.
          </div>
        )}
        {!pending && nSel > 0 && (
          <div className="selbar" role="group" aria-label="Selected reporters">
            <span className="count">{nSel} selected{selAll ? " (all that match)" : ""}</span>
            <span className="grow" />
            <button type="button" className="btn sm dng" onClick={() => setPending({ count: nSel, body: selAll ? { match: filterOf() } : { keys: sel } })}>
              Remove {nSel}…
            </button>
            <button type="button" className="btn sm" onClick={() => (setSel([]), setSelAll(false))}>
              Clear selection
            </button>
          </div>
        )}
        {!pending && !selAll && data && pageAllSelected && data.total > rows.length && (
          <div className="selmore">
            All {rows.length} on this page are selected.{" "}
            <button type="button" onClick={() => setSelAll(true)}>
              Select all {data.total} that match
            </button>
          </div>
        )}
        {err && (
          <div className="err" role="alert">
            {err}
          </div>
        )}
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
                    <th className="chk">
                      <input
                        type="checkbox"
                        aria-label={`Select all ${rows.length} on this page`}
                        checked={pageAllSelected}
                        onChange={(e) => {
                          setSelAll(false);
                          setPending(null);
                          setSel((cur) => (e.target.checked ? [...new Set([...cur, ...rows.map((r) => r.key)])] : cur.filter((k) => !rows.some((r) => r.key === k))));
                        }}
                      />
                    </th>
                    {th("state", "State")}
                    {th("name", "Machine")}
                    {th("who", "Person")}
                    {th("token", "Token")}
                    {th("ver", "Reporter version")}
                    {th("last", "Last report")}
                    {th("sessions", "Sessions", "n")}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.key} className={`rw${sel.includes(r.key) || selAll ? " sel" : ""}`} onClick={() => setOpen(r.key)}>
                      <td className="chk" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.includes(r.key) || selAll} onChange={(e) => toggle(r.key, e.target.checked)} />
                      </td>
                      <td>
                        <StateBadge r={r} serverTime={data.serverTime} serverStartedAt={data.serverStartedAt} />
                      </td>
                      <td>
                        <button type="button" className="rname" onClick={(e) => (e.stopPropagation(), setOpen(r.key))} aria-label={`Open details for ${r.name}`}>
                          {r.name}
                        </button>
                        {nameDetail(r) && (
                          <span className="sub tt" tabIndex={0} title={nameDetail(r)} aria-label={nameDetail(r)}>
                            no name set
                          </span>
                        )}
                        <span className="sub mono">{r.key.startsWith("addr:") || r.key.startsWith("hooks:") ? `no machine id, matched by address ${r.key.slice(r.key.indexOf(":") + 1)}` : r.key}</span>
                      </td>
                      <td>{r.who}</td>
                      <td>
                        <Token r={r} />
                      </td>
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
      </Panel>
    </Section>
    <IgnoreRules api={api} rules={rules.data?.rules} error={rules.error} onLocked={props.onLocked} onChanged={() => (rules.reload(), list.reload())} />
    </>
  );
}

/** The ignore rules (issue #167): every rule can be removed, so a mistake can be undone. A matching reporter is refused. */
function IgnoreRules(props: { api: AdminApi; rules: IgnoreRule[] | undefined; error: string | null; onLocked: () => void; onChanged: () => void }) {
  const { api, rules } = props;
  const [kind, setKind] = useState<IgnoreRule["kind"]>("address");
  const [pattern, setPattern] = useState("");
  const [err, setErr] = useState("");
  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      setErr("");
      props.onChanged();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) props.onLocked();
      else setErr(failText(e));
    }
  };
  return (
    <Section
      id="rules-h"
      title="Ignore rules"
      help={
        <>
          A reporter that matches a rule is refused. Its sessions stop appearing on the fleet until you remove the rule. Use <span className="mono">*</span> for “anything”, as in <span className="mono">10.88.*</span> or <span className="mono">*-sim</span>.
        </>
      }
    >
      <Panel>
      {rules && rules.length === 0 && <div className="none">No rules. Every reporter is accepted.</div>}
      {rules && rules.length > 0 && (
        <div className="tw2">
          <table className="ptab" aria-label="Ignore rules">
            <thead>
              <tr>
                <th>Matches</th>
                <th>Pattern</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((x) => (
                <tr key={x.id}>
                  <td>{x.kind === "key" ? "Key" : x.kind === "address" ? "Address" : "Version"}</td>
                  <td className="mono">{x.pattern}</td>
                  <td className="mono muted">{day(x.createdAt)}</td>
                  <td className="n">
                    <button type="button" className="btn sm" aria-label={`Remove the rule for ${x.pattern}`} onClick={() => void act(() => api("DELETE", `/reporters/ignores/${x.id}`))}>
                      Remove rule
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(err || props.error) && (
        <div className="err" role="alert">
          {err || `Could not load the ignore rules (${props.error}).`}
        </div>
      )}
      <form
        className="ruleform"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pattern.trim()) return setErr("Enter what to match.");
          void act(async () => {
            await api("POST", "/reporters/ignores", { kind, pattern: pattern.trim() });
            setPattern("");
          });
        }}
      >
        <label htmlFor="rule-kind" className="hint">
          Rule matches
        </label>
        <select className="field sm" id="rule-kind" value={kind} onChange={(e) => setKind(e.target.value as IgnoreRule["kind"])}>
          <option value="key">Key</option>
          <option value="address">Address</option>
          <option value="version">Version</option>
        </select>
        <input className="field mono" aria-label="Pattern" placeholder="10.88.* or *-sim" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <button type="submit" className="btn sm">
          Ignore matching reporters
        </button>
      </form>
      </Panel>
    </Section>
  );
}

function Detail(props: { api: AdminApi; id: string; onBack: () => void; onLocked: () => void }) {
  const { api, id } = props;
  const path = `/reporters/${encodeURIComponent(id)}`;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const one = useList<ReporterDetail>(api, `${path}${query({ page, pageSize })}`, props.onLocked);
  useRefresh(one.reload);
  const [confirm, setConfirm] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [ignoreKind, setIgnoreKind] = useState<IgnoreRule["kind"]>("key");
  const [err, setErr] = useState("");
  const d = one.data;

  const ignore = async () => {
    if (!d) return;
    const pattern = ignoreKind === "key" ? d.key : ignoreKind === "address" ? d.source : d.version;
    if (!pattern) return setErr("This reporter has no address to ignore.");
    try {
      await api("POST", "/reporters/ignores", { kind: ignoreKind, pattern });
      props.onBack();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) props.onLocked();
      else setErr(failText(e));
    }
  };

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
    <>
    <Panel>
      {back}
      <div className="dhead">
        <h2>
          {d.name} <StateBadge r={d} serverTime={d.serverTime} serverStartedAt={d.serverStartedAt} />
          {d.adminSecret && <Token r={d} />}
        </h2>
        <div className="dacts">
          {!ignoring && !confirm && (
            <button type="button" className="btn sm" title={IGNORE_HINT} onClick={() => setIgnoring(true)}>
              Ignore…
            </button>
          )}
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
            <button type="button" className="btn sm dng" title={REMOVE_HINT} onClick={() => setConfirm(true)}>
              Remove from list
            </button>
          )}
        </div>
      </div>
      {ignoring && (
        <form
          className="ignform"
          role="group"
          aria-label={`Ignore ${d.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void ignore();
          }}
        >
          <b>Ignore {d.name}?</b>
          <label className="opt">
            <input type="radio" name="ignore-kind" checked={ignoreKind === "key"} onChange={() => setIgnoreKind("key")} />
            <span>
              This reporter only <span className="hint mono">{d.key}</span>
            </span>
          </label>
          {d.source && (
            <label className="opt">
              <input type="radio" name="ignore-kind" checked={ignoreKind === "address"} onChange={() => setIgnoreKind("address")} />
              <span>
                Everything from its address <span className="hint mono">{d.source}</span>
              </span>
            </label>
          )}
          <label className="opt">
            <input type="radio" name="ignore-kind" checked={ignoreKind === "version"} onChange={() => setIgnoreKind("version")} />
            <span>
              Every reporter on version <span className="hint mono">{d.version}</span>
            </span>
          </label>
          <div className="warnline">
            <WarnIcon />
            <span>Its reports are turned away, so its sessions stop appearing on the fleet. You can undo this from the Ignore rules list.</span>
          </div>
          <div className="confirm">
            <button type="submit" className="btn sm dng">
              Ignore and remove
            </button>
            <button type="button" className="btn sm" onClick={() => setIgnoring(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {err && (
        <div className="err" role="alert">
          {err}
        </div>
      )}
      {d.adminSecret && (
        <div className="callout" role="alert">
          <WarnIcon />
          <h3>This reporter is using the admin secret</h3>
          <p>
            {d.name} reports with the admin secret instead of a token made for one person. Its {d.sessions} {d.sessions === 1 ? "session belongs" : "sessions belong"} to no one, and anyone who holds that secret can report as anyone. On a server only you use this is allowed, but it is not meant to stay that way.
          </p>
          <p>
            <b>To fix it:</b>
          </p>
          <ol>
            <li>In Admin &gt; People, make a person for whoever runs this reporter, and copy their token.</li>
            <li>
              In Claude Code{d.source ? ` on ${d.source}` : ""}, run <span className="mono">/plugin configure podium-reporter</span>.
            </li>
            <li>
              Enter that token as <span className="mono">token</span> and the person's name as <span className="mono">userName</span>.
            </li>
          </ol>
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
            ["Machine", d.named || !nameDetail(d) ? d.name : <span key="n" className="tt" tabIndex={0} title={nameDetail(d)}>{d.name} (no name set)</span>],
            ...(d.named || !nameDetail(d) ? [] : ([["Why unnamed", nameDetail(d)]] as [string, React.ReactNode][])),
            ["Machine id", d.machineId ? <span key="m" className="mono">{d.machineId}</span> : <span key="m" className="tt" title="The reporter has no user name set, so it sends no machine id and is matched by source address.">Not sent</span>],
            ["Source address", <span key="a" className="mono">{d.source ?? "unknown"}</span>],
            ["Person", d.who],
            ["Token", d.adminSecret ? <Token key="t" r={d} /> : d.credential ? <span key="t" className="mono tt" title="The token's key id, which finds the person. The secret part is never shown or kept.">{d.credential}</span> : "none"],
          ])}
        </section>
      </div>
    </Panel>
    <Section id="rep-sessions-h" title="Recent sessions" help="The sessions this reporter sent that the server still holds, newest first.">
      <Panel>
        {d.recentTotal ? (
          <>
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
              <div className="empty">No sessions on this page.</div>
            )}
            <Pager id="rep-sessions" page={d.recentPage} pageSize={d.recentPageSize} total={d.recentTotal} onPage={setPage} onSize={(n) => (setPageSize(n), setPage(1))} />
          </>
        ) : (
          <div className="empty">
            <span className="tt" title="Sessions are deleted 30 days after they end.">
              No sessions left.
            </span>
          </div>
        )}
      </Panel>
    </Section>
    <Section id="rep-turned-h" title="Reports the server turned away" help="The latest refusals from this reporter's address. The server keeps them in memory only, so a restart clears them.">
      <Panel>
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
      </Panel>
    </Section>
    </>
  );
}
