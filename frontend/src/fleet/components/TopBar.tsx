import { fmtClock } from "../format";
import type { Phase } from "../store";
import { APP_NAME } from "../types";
import { Logo } from "./Icons";

export function TopBar(props: { phase: Phase; reporters: number; lastMessageAt: number; now: number; onTheme: () => void; theme: string }) {
  const { phase, reporters, lastMessageAt, now } = props;
  const synced = lastMessageAt ? Math.max(0, (now - lastMessageAt) / 1000) : null;
  return (
    <header className="top">
      <div className="logo">
        <Logo />
        {APP_NAME}
      </div>
      {phase === "disconnected" ? (
        <span className="pill bad" role="status">
          <span className="dot bad" aria-hidden="true" />
          disconnected, retrying
        </span>
      ) : phase === "loading" ? (
        <span className="pill" role="status">
          <span className="dot" aria-hidden="true" />
          connecting…
        </span>
      ) : (
        <span className="pill" role="status">
          <span className="dot running" aria-hidden="true" />
          {reporters} reporter{reporters === 1 ? "" : "s"} live, synced {synced === null ? "–" : `${synced.toFixed(1)}s`} ago
        </span>
      )}
      <span className="pill mono" aria-label="Local time">
        {fmtClock(now)}
      </span>
      <span className="spacer" />
      <a className="btn" href="#/history">
        History
      </a>
      <button type="button" className="btn" onClick={props.onTheme} aria-label="Toggle light and dark theme" title={`Theme: ${props.theme}`}>
        Theme
      </button>
    </header>
  );
}
