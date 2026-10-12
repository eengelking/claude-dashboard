// The Podium fleet console: top bar, the orchestrator rail, the wall or one orchestrator's page, and
// the activity / agent panel. Data comes from useFleet; everything here is presentation state.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./fleet.css";
import { filterSessions, defaultAgentDir, sortSessions, type AgentSortKey, type SortKey, type StatusFilter } from "./logic";
import { PAGE } from "./components/ActivityList";
import type { AgentSort } from "./components/AgentTree";
import { FocusView } from "./components/FocusView";
import { ThemePicker } from "./components/ThemePicker";
import { Rail, type Split } from "./components/Rail";
import { ResizeHandle } from "./components/ResizeHandle";
import { SidePanel } from "./components/SidePanel";
import { TopBar } from "./components/TopBar";
import { Wall } from "./components/Wall";
import { removeSession, useFleet, type UseFleetOptions } from "./useFleet";
import { useNow } from "./useNow";
import { useResizable } from "./useResizable";
import { useTheme } from "./useTheme";
import { useHotkeys } from "./useHotkeys";
import { useIdle } from "./useIdle";
import { usePanes } from "./usePanes";
import { APP_NAME, type ActivityView } from "./types";
import type { FleetState } from "./store";


const ENTER_MS = 1000;

/** Marks ids that appeared after the first render, for one second, so they play the enter animation. */
function useEntering(ids: readonly string[], ready: boolean): (id: string) => boolean {
  const first = useRef(new Map<string, number>());
  const primed = useRef(false);
  const now = Date.now();
  if (ready) {
    for (const id of ids) if (!first.current.has(id)) first.current.set(id, primed.current ? now : 0);
    primed.current = true;
  }
  return (id: string) => {
    const t = first.current.get(id);
    return !!t && now - t < ENTER_MS;
  };
}

export interface FleetAppProps {
  /** For tests: drive the app from a given state instead of the server. */
  state?: FleetState;
  fleetOptions?: UseFleetOptions;
}

function LiveFleetApp({ fleetOptions }: { fleetOptions?: UseFleetOptions }) {
  const state = useFleet(fleetOptions);
  return <FleetView state={state} />;
}

export function FleetApp(props: FleetAppProps = {}) {
  useEffect(() => {
    document.title = APP_NAME;
  }, []);
  if (props.state) return <FleetView state={props.state} />;
  return <LiveFleetApp fleetOptions={props.fleetOptions} />;
}

export function FleetView({ state }: { state: FleetState }) {
  const now = useNow();
  const theme = useTheme();
  const [sel, setSel] = useState<string | null>(null);
  const [selAgent, setSelAgent] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ status: StatusFilter; q: string }>({ status: "all", q: "" });
  const [sort, setSort] = useState<SortKey>("status");
  const [evShow, setEvShow] = useState(PAGE);
  const [aSort, setASort] = useState<AgentSort>({ key: null, dir: 1 });
  const [notice, setNotice] = useState<string | null>(null);
  const cols = useRef<HTMLDivElement>(null);
  const container = useCallback(() => cols.current, []);
  const resize = useResizable(container);
  const panes = usePanes();
  const idle = useIdle(panes.wall);
  const fullscreen = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const all = useMemo(() => Object.values(state.sessions), [state.sessions]);
  const live = all.filter((s) => !state.leaving[s.id]);
  const sorted = useMemo(() => sortSessions(all, sort), [all, sort]);
  const shown = filterSessions(sorted, filter);
  const split: Split = {
    running: live.filter((s) => s.status === "running").length,
    waiting: live.filter((s) => s.status === "waiting").length,
    stale: live.filter((s) => s.status === "stale").length,
  };
  const reporters = live.filter((s) => s.status !== "stale").length;
  const ready = state.phase !== "loading";
  const enteringSession = useEntering(all.map((s) => s.id), ready);
  const newEvent = useEntering(state.events.map((e) => e.id), ready);
  const selected = sel ? state.sessions[sel] ?? null : null;

  // A selected session that leaves the live set clears the selection, with a message.
  useEffect(() => {
    if (!sel) return;
    if (state.gone[sel] || (ready && !state.sessions[sel])) {
      const name = state.sessions[sel]?.name ?? "That session";
      setNotice(`${name} ${state.gone[sel] === "dropped" ? "stopped reporting" : "ended"} and left the fleet.`);
      setSel(null);
      setSelAgent(null);
    }
  }, [sel, state.gone, state.sessions, ready]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const flashRow = useCallback((id: string | null) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(null);
    if (!id) return;
    (window.requestAnimationFrame ?? ((cb: () => void) => setTimeout(cb, 16)))(() => setFlash(id));
    flashTimer.current = setTimeout(() => setFlash(null), 1700);
  }, []);

  const selectSession = (id: string | null) => {
    setSel(id);
    setSelAgent(null);
    setNotice(null);
  };
  const onRemove = (id: string) => {
    removeSession(id).catch((err: Error) => setNotice(`Could not remove the session: ${err.message}. Try again.`));
  };
  const selectAgent = (id: string) => {
    setSelAgent(id);
    flashRow(null);
  };
  const openEvent = (e: ActivityView) => {
    const s = state.sessions[e.sessionId];
    if (!s || state.gone[e.sessionId]) return;
    const agent = e.agentId && s.agents.some((a) => a.id === e.agentId) ? e.agentId : null;
    setSel(e.sessionId);
    setSelAgent(agent);
    setNotice(null);
    flashRow(agent);
    const side = document.querySelector(".podium .side");
    if (side) side.scrollTop = 0;
  };
  const onAgentSort = (key: AgentSortKey | null) => {
    setASort((cur) => (key === null ? { key: null, dir: 1 } : cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: defaultAgentDir(key) }));
  };

  // A collapsed pane keeps a slim 24 px tab; its saved width comes back when it opens again.
  const colStyle = {
    ...(panes.collapsed.left
      ? { ["--rail-w" as string]: "24px" }
      : resize.widths.rail !== undefined ? { ["--rail-w" as string]: `${resize.widths.rail}px` } : {}),
    ...(panes.collapsed.right
      ? { ["--side-w" as string]: "24px" }
      : resize.widths.side !== undefined ? { ["--side-w" as string]: `${resize.widths.side}px` } : {}),
  };

  const { enterWall, exitWall } = panes;
  // Fullscreen is only ever asked for from the click on the wall mode button, and a refusal changes nothing.
  const startWall = (fromClick: boolean) => {
    enterWall();
    if (!fromClick) return;
    try {
      const asked = document.documentElement.requestFullscreen?.();
      if (asked) {
        fullscreen.current = true;
        asked.catch(() => {
          fullscreen.current = false;
        });
      }
    } catch {
      fullscreen.current = false;
    }
  };
  const stopWall = exitWall;
  // Wall mode ends by any route (button, Esc, opening a pane from its tab), so fullscreen is released here.
  useEffect(() => {
    if (!panes.wall && fullscreen.current) {
      fullscreen.current = false;
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    }
  }, [panes.wall]);
  // Leaving fullscreen with the browser's own Esc also leaves wall mode.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && fullscreen.current) {
        fullscreen.current = false;
        exitWall();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [exitWall]);

  const { toggle } = panes;
  // In the top bar's own row while it is open, floating in the corner once it is collapsed.
  const wallButton = panes.wall ? (
    <button type="button" className="btn wall-exit" data-wall-control onClick={stopWall} aria-label="Exit wall mode" title="Exit wall mode (Esc)">
      Exit wall mode
    </button>
  ) : (
    <button type="button" className="btn wall-enter" data-wall-control onClick={() => startWall(true)} aria-label="Enter wall mode" title="Collapse everything for a wall display (w)">
      Wall mode
    </button>
  );
  useHotkeys((e) => {
    if (e.key === "[") toggle("left");
    else if (e.key === "]") toggle("right");
    else if (e.key === "\\") toggle("top");
    else if (e.key === "w" || e.key === "W") (panes.wall ? stopWall : () => startWall(false))();
    else if (e.key === "Escape" && panes.wall) stopWall();
  });

  return (
    <div className={`podium${panes.wall ? " wall-on" : ""}${idle ? " idle" : ""}`}>
      {panes.collapsed.top && (
        <div className="wall-ctl" data-wall-control>
          {wallButton}
        </div>
      )}
      <div className="app">
        <TopBar
          phase={state.phase}
          reporters={reporters}
          lastMessageAt={state.lastMessageAt}
          now={now}
          collapsed={panes.collapsed.top}
          onCollapse={() => toggle("top")}
          wall={wallButton}
        />
        {panes.collapsed.top && (
          <div className={`strip${state.phase === "disconnected" ? " bad" : ""}`}>
            <button type="button" aria-expanded="false" aria-controls="podium-top" title={"Show the top bar (\\)"} onClick={() => toggle("top")}>
              Show top bar
            </button>
          </div>
        )}
        {state.phase === "disconnected" ? (
          <div className="banner bad" role="alert">
            <b>Lost the connection to the Podium server.</b> Retrying every 2 seconds. Numbers below are frozen until it reconnects.
          </div>
        ) : state.phase === "loading" && state.error ? (
          <div className="banner bad" role="alert">
            <b>Cannot reach the Podium server.</b> Start it with <code>npm run dev</code> (or <code>npm run dev -w server</code>); this page connects by itself.
          </div>
        ) : panes.collapsed.top ? null : (
          <div className="banner has-picker">
            <span>
              <b>Live fleet.</b> Cost is an estimate from token counts and a price table, not a bill.
            </span>
            <ThemePicker theme={theme} />
          </div>
        )}
        <div className="cols" ref={cols} style={colStyle}>
          <Rail
            sessions={sorted}
            selected={sel}
            onSelect={selectSession}
            split={split}
            entering={enteringSession}
            leaving={state.leaving}
            liveCount={live.length}
            onRemove={onRemove}
            collapsed={panes.collapsed.left}
            onToggle={() => toggle("left")}
          />
          <main className="main" id="podium-main">
            {notice && (
              <div className="callout notice" role="status">
                <div>{notice}</div>
              </div>
            )}
            {state.phase === "loading" && !state.error ? (
              <div className="none">Connecting to the Podium server…</div>
            ) : selected ? (
              <FocusView
                s={selected}
                now={now}
                config={state.config}
                sort={aSort}
                onSort={onAgentSort}
                selectedAgent={selAgent}
                flashAgent={flash}
                onAgent={selectAgent}
                onRemove={onRemove}
              />
            ) : (
              <Wall
                sessions={shown}
                totalLive={all.length}
                kpis={state.kpis}
                split={split}
                filter={filter}
                onFilter={setFilter}
                sort={sort}
                onSort={setSort}
                cleared={state.clearedToday}
                now={now}
                config={state.config}
                entering={enteringSession}
                leaving={state.leaving}
                onOpen={selectSession}
                onRemove={onRemove}
              />
            )}
          </main>
          <SidePanel
            events={state.events}
            sessions={state.sessions}
            gone={state.gone}
            selected={selected}
            selectedAgent={selAgent}
            shown={evShow}
            onShown={setEvShow}
            isNew={newEvent}
            onOpenEvent={openEvent}
            onAgent={selectAgent}
            onBack={() => setSelAgent(null)}
            now={now}
            collapsed={panes.collapsed.right}
            onToggle={() => toggle("right")}
          />
          {!panes.collapsed.left && <ResizeHandle panel="rail" r={resize} container={container} label="Resize orchestrator list" />}
          {!panes.collapsed.right && <ResizeHandle panel="side" r={resize} container={container} label="Resize activity panel" />}
        </div>
      </div>
    </div>
  );
}

export default FleetApp;
