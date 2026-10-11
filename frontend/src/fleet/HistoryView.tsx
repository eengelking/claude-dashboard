// #/history (SPEC T5.3): sessions that ended or were dropped on a day, and a read-only orchestrator
// page for one of them, built from its stored rows.
import { useEffect, useState } from "react";
import "./fleet.css";
import { fmtClock, fmtDur, fmtUsd } from "./format";
import type { AgentSortKey } from "./logic";
import { defaultAgentDir } from "./logic";
import { AgentDetail } from "./components/AgentDetail";
import type { AgentSort } from "./components/AgentTree";
import { ModelChip } from "./components/Chips";
import { FocusView } from "./components/FocusView";
import { Logo } from "./components/Icons";
import { useTheme } from "./useTheme";
import { APP_NAME, type HistoryRow, type SessionView } from "./types";


export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status === 404 ? "not found" : `HTTP ${res.status}`);
  return (await res.json()) as T;
}

const CONFIG = { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000 };

export function HistoryView({ base = "/api/fleet", initialDay }: { base?: string; initialDay?: string }) {
  const theme = useTheme();
  const [day, setDay] = useState(initialDay ?? localDay(Date.now()));
  const [rows, setRows] = useState<Load<HistoryRow[]>>({ state: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [session, setSession] = useState<Load<SessionView> | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [sort, setSort] = useState<AgentSort>({ key: null, dir: 1 });

  useEffect(() => {
    document.title = `${APP_NAME} history`;
  }, []);

  useEffect(() => {
    let live = true;
    setRows({ state: "loading" });
    getJson<{ sessions: HistoryRow[] }>(`${base}/history?day=${encodeURIComponent(day)}`)
      .then((b) => live && setRows({ state: "ok", data: b.sessions.slice().sort((a, b) => b.endedAt - a.endedAt) }))
      .catch((e: Error) => live && setRows({ state: "error", message: e.message }));
    return () => {
      live = false;
    };
  }, [base, day]);

  useEffect(() => {
    if (!openId) {
      setSession(null);
      return;
    }
    let live = true;
    setSession({ state: "loading" });
    setAgent(null);
    getJson<SessionView>(`${base}/sessions/${encodeURIComponent(openId)}`)
      .then((s) => live && setSession({ state: "ok", data: s }))
      .catch((e: Error) => live && setSession({ state: "error", message: e.message }));
    return () => {
      live = false;
    };
  }, [base, openId]);

  const onSort = (key: AgentSortKey | null) =>
    setSort((cur) => (key === null ? { key: null, dir: 1 } : cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: defaultAgentDir(key) }));

  const s = session?.state === "ok" ? session.data : null;
  const selected = s && agent ? s.agents.find((a) => a.id === agent) : undefined;

  return (
    <div className="podium">
      <div className="app" style={{ gridTemplateRows: "auto auto 1fr" }}>
        <header className="top">
          <div className="logo">
            <Logo />
            {APP_NAME}
          </div>
          <span className="pill">History</span>
          <span className="spacer" />
          <a className="btn" href="#/">
            Live fleet
          </a>
          <button type="button" className="btn" onClick={theme.toggle} aria-label="Toggle light and dark theme">
            Theme
          </button>
        </header>
        <div className="banner">
          <b>Past sessions.</b> Read-only: built from what the server stored. Cost is an estimate, not a bill.
        </div>
        <div className="history">
          <main className="main">
            {s ? (
              <>
                <button type="button" className="back" style={{ padding: "0 0 10px" }} onClick={() => setOpenId(null)}>
                  ← Back to {day}
                </button>
                <FocusView s={s} now={s.lastSeenAt} config={CONFIG} sort={sort} onSort={onSort} selectedAgent={agent} flashAgent={null} onAgent={setAgent} />
              </>
            ) : session?.state === "loading" ? (
              <div className="none">Loading the session…</div>
            ) : session?.state === "error" ? (
              <div className="none">Could not load that session ({session.message}).</div>
            ) : (
              <>
                <div className="tools">
                  <label className="sortlab" htmlFor="podium-day">
                    Day
                  </label>
                  <input id="podium-day" className="search" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
                  <span className="spacer" />
                  {rows.state === "ok" && <span className="kpi-cap">{rows.data.length} sessions ended</span>}
                </div>
                {rows.state === "loading" ? (
                  <div className="none">Loading…</div>
                ) : rows.state === "error" ? (
                  <div className="none">Cannot reach the Podium server ({rows.message}). Start it with npm run dev.</div>
                ) : rows.data.length === 0 ? (
                  <div className="none">No sessions ended on {day}.</div>
                ) : (
                  <div className="sec tw">
                    <table className="htable">
                      <thead>
                        <tr>
                          <th>Session</th>
                          <th>Project</th>
                          <th>Model</th>
                          <th className="num">Ended</th>
                          <th className="num">Duration</th>
                          <th className="num">Est. cost</th>
                          <th className="num">Blowouts</th>
                          <th className="num">Agents</th>
                          <th>End reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.data.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <button type="button" className="lk" onClick={() => setOpenId(r.id)}>
                                {r.name}
                              </button>
                            </td>
                            <td className="mono">{r.project}</td>
                            <td>
                              <ModelChip family={r.modelFamily} model={r.model} />
                            </td>
                            <td className="num">{fmtClock(r.endedAt)}</td>
                            <td className="num">{fmtDur(r.durationSec)}</td>
                            <td className="num">{fmtUsd(r.costUsd)}</td>
                            <td className="num">{r.blowouts || "–"}</td>
                            <td className="num">{r.agents}</td>
                            <td>{r.endReason ?? "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </main>
          {s && selected && (
            <aside className="side" aria-label="Agent detail">
              <AgentDetail s={s} a={selected} now={s.lastSeenAt} onBack={() => setAgent(null)} onAgent={setAgent} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
