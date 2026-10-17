// #/admin (issue #36): create and revoke the tokens people report with, arrange them in groups, and read the admin log.
// Opened with a name and a token: an Administrator's own, or the name Admin with the admin secret (#215). A browser already
// signed in to respond as an Administrator opens without typing them. The token is typed into a password field, sent once,
// and dropped; the session is an HttpOnly cookie this page cannot read. A newly made token is held in state only until the owner says it is saved.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import "../fleet.css";
import "./admin.css";
import { BrandLink } from "../components/BrandLink";
import { ConnectionPill } from "../components/ConnectionPill";
import { ThemePicker } from "../components/ThemePicker";
import { useTheme } from "../useTheme";
import { useFleet, type UseFleetOptions } from "../useFleet";
import { useHeartbeat } from "../useHeartbeat";
import { usePageVisible } from "../usePageVisible";
import { reportersLive } from "../store";
import { APP_NAME } from "../types";
import { AdminError, makeApi } from "./adminApi";
import { GroupsTab } from "./GroupsTab";
import { LogTab } from "./LogTab";
import { ModelPricesTab } from "./ModelPricesTab";
import { AdminFoot, PageHeader } from "./Page";
import { PeopleTab, type Created } from "./PeopleTab";
import { ReportersTab, type ReporterPaging } from "./ReportersTab";
import { ReportingTab } from "./ReportingTab";
import { SettingsTab } from "./SettingsTab";
import { SpendTab } from "./SpendTab";

type Status = "checking" | "locked" | "open" | "disabled";
type TabId = "people" | "groups" | "reporters" | "reporting" | "settings" | "prices" | "spend" | "log";
const PAGES: Record<TabId, { name: string; lead: string }> = {
  people: { name: "People", lead: "Each person gets a token that only works with their own name. A report is accepted when the two match." },
  groups: { name: "Groups", lead: "Arrange people into groups. The fleet wall shows a band per group." },
  reporters: { name: "Reporters", lead: "Every reporter this server has heard from, and whether it is still reporting." },
  reporting: { name: "Reporting and security", lead: "Control how reporters prove who they are, and what protects the tokens." },
  settings: { name: "Settings", lead: "Server-wide choices. A change applies to everyone on this server." },
  prices: { name: "Model prices", lead: "What Podium charges each model per million tokens, in dollars. It uses these to work out what a session cost." },
  spend: { name: "Spend", lead: "What each person or group has spent since midnight today, live or ended sessions. Estimated from tokens, not a bill." },
  log: { name: "Admin log", lead: "What happened in Admin, newest first." },
};
/** The side menu: pages in groups, in the order they are listed. */
const NAV: { name: string; icon: GroupIconName; ids: TabId[] }[] = [
  { name: "People and access", icon: "access", ids: ["people", "groups", "reporters"] },
  { name: "Server", icon: "server", ids: ["settings", "prices", "reporting"] },
  { name: "Activity", icon: "activity", ids: ["spend", "log"] },
];

type GroupIconName = "access" | "server" | "activity";
/** Outline glyphs that lead a menu group's heading; on the narrow strip they stand in for the heading. */
const GROUP_ICON: Record<GroupIconName, ReactNode> = {
  access: (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5c.4-2.4 2.2-3.8 4.5-3.8s4.1 1.4 4.5 3.8" />
      <path d="M11 3.4a2.4 2.4 0 0 1 0 4.4M12.6 10c1.2.5 1.9 1.6 2.1 3.2" />
    </>
  ),
  server: (
    <>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1" />
      <rect x="2" y="9" width="12" height="4.5" rx="1" />
      <path d="M4.5 4.75h.01M4.5 11.25h.01" />
    </>
  ),
  activity: <path d="M1.5 8h3l2-5 3 10 2-5h3" />,
};

/** Owns the fleet stream so its 2 s ticks re-render only this pill, not the whole Admin view. */
function FleetPill({ options }: { options?: UseFleetOptions }) {
  const fleet = useFleet(options);
  return <ConnectionPill phase={fleet.phase} reporters={reportersLive(fleet.sessions, fleet.leaving)} />;
}

export function AdminView({ base = "/api/admin", fleetOptions }: { base?: string; fleetOptions?: UseFleetOptions }) {
  const theme = useTheme();
  // The reporters pill's dot pulses on the fleet page's shared beat, which this root carries as data-beat.
  const root = useRef<HTMLDivElement>(null);
  useHeartbeat(root, usePageVisible());
  const api = useMemo(() => makeApi(base), [base]);
  const [status, setStatus] = useState<Status>("checking");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(() => (window.location.hash === "#/admin/settings" ? "settings" : "people"));
  const [created, setCreated] = useState<Created | null>(null);
  const [counts, setCounts] = useState<Partial<Record<TabId, number>>>({});
  const [paging, setPaging] = useState({
    people: { page: 1, pageSize: 50, q: "" },
    groups: { page: 1, pageSize: 50 },
    reporters: { page: 1, pageSize: 50, q: "", state: "", admin: false, sort: "last", dir: -1 } as ReporterPaging,
    log: { page: 1, pageSize: 50 },
  });

  useEffect(() => {
    document.title = `${APP_NAME} admin`;
  }, []);
  // Following #/admin/settings while Admin is already open (the link in the wall's confirmation) switches the tab.
  useEffect(() => {
    const onHash = () => window.location.hash === "#/admin/settings" && setTab("settings");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // A browser signed in to respond as an Administrator opens Admin with no second sign-in (#215).
  const openFromRespond = useCallback(
    () =>
      api("POST", "/unlock/from-respond").then(
        () => true,
        () => false,
      ),
    [api],
  );
  useEffect(() => {
    let live = true;
    api<{ enabled: boolean; unlocked: boolean; version?: string }>("GET", "/session")
      .then(async (s) => {
        if (!live) return;
        setVersion(s.version ?? null);
        if (s.enabled && !s.unlocked && (await openFromRespond())) return live && setStatus("open");
        if (live) setStatus(!s.enabled ? "disabled" : s.unlocked ? "open" : "locked");
      })
      .catch(() => live && (setNotice("Could not reach the server."), setStatus("locked")));
    return () => {
      live = false;
    };
  }, [api, openFromRespond]);

  // Back to the lock screen: forget any token still on screen.
  const lockedOut = useCallback((why = "Admin locked after 10 minutes without activity. Sign in with your name and token to continue.") => {
    setCreated(null);
    setNotice(why);
    setStatus("locked");
  }, []);
  // The idle lock: an Administrator still signed in to respond is let back in; anyone else gets the sign-in.
  const onLocked = useCallback(() => {
    setCreated(null);
    setStatus("checking");
    void openFromRespond().then((ok) => (ok ? setStatus("open") : lockedOut()));
  }, [lockedOut, openFromRespond]);
  const lockNow = () => {
    void api("POST", "/lock").catch(() => undefined);
    lockedOut("Admin is locked.");
  };

  const setCount = (id: TabId) => (n: number) => setCounts((c) => (c[id] === n ? c : { ...c, [id]: n }));
  const onCountPeople = useMemo(() => setCount("people"), []);
  const onCountGroups = useMemo(() => setCount("groups"), []);
  const onCountReporters = useMemo(() => setCount("reporters"), []);
  const onCountSpend = useMemo(() => setCount("spend"), []);
  const onCountLog = useMemo(() => setCount("log"), []);
  const onPeoplePaging = useCallback((p: { page?: number; pageSize?: number; q?: string }) => setPaging((s) => ({ ...s, people: { ...s.people, ...p } })), []);
  const onGroupPaging = useCallback((p: { page?: number; pageSize?: number }) => setPaging((s) => ({ ...s, groups: { ...s.groups, ...p } })), []);
  const onReportersPaging = useCallback((p: Partial<ReporterPaging>) => setPaging((s) => ({ ...s, reporters: { ...s.reporters, ...p } })), []);
  const onLogPaging = useCallback((p: { page?: number; pageSize?: number }) => setPaging((s) => ({ ...s, log: { ...s.log, ...p } })), []);

  const page = PAGES[tab];
  const pageRef = useRef<HTMLDivElement>(null);
  // The page scrolls on its own, so a new page would otherwise open at the old page's scroll position.
  useEffect(() => {
    pageRef.current?.scrollTo?.(0, 0);
  }, [tab]);
  return (
    <div ref={root} className="podium">
      <div className="app" style={{ gridTemplateRows: "auto auto 1fr" }}>
        <header className="top">
          <BrandLink />
          <span className="pill">Admin</span>
          <FleetPill options={fleetOptions} />
          <span className="spacer" />
          <a className="btn" href="#/">
            Back to fleet
          </a>
        </header>
        <div className="banner has-picker">
          <span>
            <b>Admin.</b> Tokens, groups, reporters and settings for this server.
          </span>
          <ThemePicker theme={theme} />
        </div>
        <main className="adminv" aria-label="Admin">
          {status === "checking" && (
            <div className="solo">
              <div className="solo-in empty">Checking…</div>
              <AdminFoot version={version} />
            </div>
          )}
          {status === "disabled" && (
            <div className="solo">
              <div className="solo-in">
                <div className="lock">
                  <h1>Admin is off</h1>
                  <p className="lead">This server is running without a token, so there is nothing to protect Admin with. Run podiumctl config unset PODIUM_TOKEN and podiumctl restart (the first start makes one), then reload.</p>
                </div>
              </div>
              <AdminFoot version={version} />
            </div>
          )}
          {status === "locked" && (
            <div className="solo">
              <div className="solo-in">
                <LockForm api={api} notice={notice} onUnlocked={() => (setNotice(""), setStatus("open"))} />
              </div>
              <AdminFoot version={version} />
            </div>
          )}
          {status === "open" && (
            <div className="shell">
              <nav className="nav" aria-label="Admin sections">
                <div className="navin">
                  {NAV.map((g) => (
                    <div key={g.name} className="ngroup" role="group" aria-label={g.name}>
                      <span className="gh" aria-hidden="true">
                        <svg className="gi" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          {GROUP_ICON[g.icon]}
                        </svg>
                        <span className="gt">{g.name}</span>
                      </span>
                      {g.ids.map((id) => (
                        <button key={id} type="button" className="navbtn" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
                          {PAGES[id].name}
                          {counts[id] !== undefined && <span className="n">{counts[id]}</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                  <div className="navfoot">
                    <button type="button" className="btn" onClick={lockNow}>
                      Lock Admin
                    </button>
                    <span className="hint">Locks after 10 minutes without activity.</span>
                  </div>
                </div>
                <AdminFoot version={version} />
              </nav>
              <div className="apage" ref={pageRef}>
                <div className="apage-in">
                  {created && <OnceSettings c={created} onDone={() => setCreated(null)} />}
                  <PageHeader title={page.name} lead={page.lead} />
                  {tab === "people" && <PeopleTab api={api} {...paging.people} onPaging={onPeoplePaging} onCreated={setCreated} onCount={onCountPeople} onLocked={onLocked} />}
                  {tab === "groups" && <GroupsTab api={api} {...paging.groups} onPaging={onGroupPaging} onCount={onCountGroups} onLocked={onLocked} />}
                  {tab === "reporters" && <ReportersTab api={api} paging={paging.reporters} onPaging={onReportersPaging} onCount={onCountReporters} onLocked={onLocked} />}
                  {tab === "reporting" && <ReportingTab api={api} onLocked={onLocked} />}
                  {tab === "settings" && <SettingsTab api={api} onLocked={onLocked} />}
                  {tab === "prices" && <ModelPricesTab api={api} onLocked={onLocked} />}
                  {tab === "spend" && <SpendTab fleetOptions={fleetOptions} onCount={onCountSpend} />}
                  {tab === "log" && <LogTab api={api} {...paging.log} onPaging={onLogPaging} onCount={onCountLog} onLocked={onLocked} />}
                </div>
                <AdminFoot version={version} className="afoot-narrow" />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LockForm({ api, notice, onUnlocked }: { api: ReturnType<typeof makeApi>; notice: string; onUnlocked: () => void }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !token) return setErr("Enter your name and your token.");
    setBusy(true);
    setErr("");
    try {
      await api("POST", "/unlock", { name: name.trim(), token });
      setToken("");
      onUnlocked();
    } catch (e2) {
      setToken("");
      if (e2 instanceof AdminError && e2.status === 429) {
        setErr(`Too many wrong tries. Try again in ${Math.max(1, Math.ceil((e2.retryAfterSec ?? 900) / 60))} minutes.`);
      } else if (e2 instanceof AdminError && e2.status === 401) {
        setErr("That name and token do not open Admin.");
      } else {
        setErr(e2 instanceof Error ? e2.message : "Could not unlock.");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="lock" onSubmit={submit} autoComplete="off">
      <div>
        <h1>Admin</h1>
        <p className="lead">Create and revoke the tokens people use to report to this Podium. Sign in with your name and token to continue. If you are signed in to respond as an Administrator, Admin opens without this, unless you locked it with Lock Admin.</p>
      </div>
      {notice && (
        <div className="hint ink2" role="status">
          {notice}
        </div>
      )}
      <label htmlFor="admin-name">Name</label>
      <input className="field" id="admin-name" type="text" autoComplete="off" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-describedby="admin-secret-hint" />
      <label htmlFor="admin-secret">Token</label>
      <input className="field mono" id="admin-secret" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} aria-describedby="admin-secret-hint" />
      {err && (
        <div className="errbox" role="alert">
          {err}
        </div>
      )}
      <div className="row2">
        <button type="submit" className="btn pri" disabled={busy}>
          Unlock Admin
        </button>
      </div>
      <div className="hint" id="admin-secret-hint">
        Use your own name and token if you are in Administrators, or the name <span className="mono">Admin</span> with the admin secret. On the server’s machine, <span className="mono">podiumctl token</span> prints the secret. Admin locks again after 10 minutes without activity. After 5 wrong tries, a secret or token alike, it locks for 15 minutes.
      </div>
    </form>
  );
}

/** The show-once panel: the settings to paste into the person's reporter. Stays above the tabs. */
function OnceSettings({ c, onDone }: { c: Created; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const text = `userName: ${c.name}\ntoken: ${c.token}\nserverUrl: ${window.location.origin}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied.");
    } catch {
      setMsg("Could not copy. Select the text and copy it.");
    }
  };
  return (
    <section className="once" aria-labelledby="admin-once-h">
      <h2 id="admin-once-h">Token for {c.name}</h2>
      <div className="hint ink2">
        This is the only time the token is shown. Put these settings in {c.name}’s reporter. The token does nothing without the matching name. It stays here while you switch tabs.
      </div>
      <pre className="code" id="admin-once-code">
        {text}
      </pre>
      <div className="row2">
        <button type="button" className="btn pri" onClick={copy}>
          Copy settings
        </button>
        <button type="button" className="btn" onClick={onDone}>
          I have saved it
        </button>
        <span className="hint" role="status">
          {msg}
        </span>
      </div>
    </section>
  );
}
