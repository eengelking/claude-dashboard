// #/admin (issue #36): create and revoke the tokens people report with, arrange them in groups, and read the admin log.
// Opened with the admin secret. The secret is typed into a password field, sent once, and dropped; the session is an
// HttpOnly cookie this page cannot read. A newly made token is held in state only until the owner says it is saved.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "../fleet.css";
import "./admin.css";
import { BrandLink } from "../components/BrandLink";
import { ThemePicker } from "../components/ThemePicker";
import { useTheme } from "../useTheme";
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

type Status = "checking" | "locked" | "open" | "disabled";
type TabId = "people" | "groups" | "reporters" | "reporting" | "settings" | "prices" | "log";
const PAGES: Record<TabId, { name: string; lead: string }> = {
  people: { name: "People", lead: "Each person gets a token that only works with their own name. A report is accepted when the two match." },
  groups: { name: "Groups", lead: "Arrange people into groups. The fleet wall shows a band per group." },
  reporters: { name: "Reporters", lead: "Every reporter this server has heard from, and whether it is still reporting." },
  reporting: { name: "Reporting and security", lead: "Control how reporters prove who they are, and what protects the tokens." },
  settings: { name: "Settings", lead: "Server-wide choices. A change applies to everyone on this server." },
  prices: { name: "Model prices", lead: "What Podium charges each model per million tokens, in dollars. It uses these to work out what a session cost." },
  log: { name: "Admin log", lead: "What happened in Admin, newest first." },
};
/** The side menu: pages in groups, in the order they are listed. */
const NAV: { name: string; ids: TabId[] }[] = [
  { name: "People and access", ids: ["people", "groups", "reporters"] },
  { name: "Server", ids: ["settings", "prices", "reporting"] },
  { name: "Activity", ids: ["log"] },
];

export function AdminView({ base = "/api/admin" }: { base?: string }) {
  const theme = useTheme();
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
  useEffect(() => {
    let live = true;
    api<{ enabled: boolean; unlocked: boolean; version?: string }>("GET", "/session")
      .then((s) => live && (setVersion(s.version ?? null), setStatus(!s.enabled ? "disabled" : s.unlocked ? "open" : "locked")))
      .catch(() => live && (setNotice("Could not reach the server."), setStatus("locked")));
    return () => {
      live = false;
    };
  }, [api]);

  // Back to the lock screen: forget any token still on screen.
  const lockedOut = useCallback((why = "Admin locked after 10 minutes without activity. Enter the secret or your token to continue.") => {
    setCreated(null);
    setNotice(why);
    setStatus("locked");
  }, []);
  const onLocked = useCallback(() => lockedOut(), [lockedOut]);
  const lockNow = () => {
    void api("POST", "/lock").catch(() => undefined);
    lockedOut("Admin is locked.");
  };

  const setCount = (id: TabId) => (n: number) => setCounts((c) => (c[id] === n ? c : { ...c, [id]: n }));
  const onCountPeople = useMemo(() => setCount("people"), []);
  const onCountGroups = useMemo(() => setCount("groups"), []);
  const onCountReporters = useMemo(() => setCount("reporters"), []);
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
    <div className="podium">
      <div className="app" style={{ gridTemplateRows: "auto auto 1fr" }}>
        <header className="top">
          <BrandLink />
          <span className="pill">Admin</span>
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
                  <p className="lead">This server is running without a token, so there is nothing to protect Admin with. Start it with one (podiumctl does this on first start), then reload.</p>
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
                        {g.name}
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
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!secret) return setErr("Enter the admin secret or your token.");
    setBusy(true);
    setErr("");
    try {
      await api("POST", "/unlock", { secret });
      setSecret("");
      onUnlocked();
    } catch (e2) {
      setSecret("");
      if (e2 instanceof AdminError && e2.status === 429) {
        setErr(`Too many wrong tries. Try again in ${Math.max(1, Math.ceil((e2.retryAfterSec ?? 900) / 60))} minutes.`);
      } else if (e2 instanceof AdminError && e2.status === 401) {
        setErr("That is not the admin secret, or a token that can open Admin.");
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
        <p className="lead">Create and revoke the tokens people use to report to this Podium. Enter the admin secret, or your own token if you are in the Administrators group.</p>
      </div>
      {notice && (
        <div className="hint ink2" role="status">
          {notice}
        </div>
      )}
      <label htmlFor="admin-secret">Admin secret or personal token</label>
      <input className="field mono" id="admin-secret" type="password" autoComplete="off" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} aria-describedby="admin-secret-hint" />
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
        Podium made this secret the first time the server started. On the server’s machine, <span className="mono">podiumctl token</span> prints it. A person’s token only opens Admin for people in Administrators. Admin locks again after 10 minutes without activity. After 5 wrong tries, a secret or token alike, it locks for 15 minutes.
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
