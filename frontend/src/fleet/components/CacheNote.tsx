// The prompt cache (#27): the cooling alert on a card and in the rail, the cache-warming chip, and the line that
// says cooling alerts are off. The server decides the state and whether an alert shows (CacheView.alert); the
// browser only counts down to `expiresAt`.
import { fmtCountdown, fmtTok, fmtUsd } from "../format";
import type { CacheAlertsView, CacheView, SessionView } from "../types";
import { IconClock } from "./Icons";

/** The cache of a session that should show the cooling alert now, or null. */
export function coolingCache(s: Pick<SessionView, "status" | "cache">): (CacheView & { expiresAt: number }) | null {
  const c = s.cache;
  if (!c || s.status !== "waiting" || c.state !== "cooling" || !c.alert || c.expiresAt === null) return null;
  return c as CacheView & { expiresAt: number };
}

/** "About 410k tokens would be written to the cache again, roughly $1.97 more." The cost is left out without a price. */
export function coldCostText(c: Pick<CacheView, "tokens" | "coldCostUsd">): string | null {
  if (c.tokens === null) return null;
  return `About ${fmtTok(c.tokens)} tokens would be written to the cache again${c.coldCostUsd !== null ? `, roughly ${fmtUsd(c.coldCostUsd)} more` : ""}.`;
}

const STOP_TEXT: Record<NonNullable<CacheView["warming"]["stopReason"]>, string> = {
  "max-duration": "Cache warming reached its time limit for this wait (the cacheWarmingMinutes option).",
  "api-error": "A ping got an API error, such as a rate limit, so warming stopped until the session runs again.",
  "nothing-to-fork": "There was nothing to keep warm: the conversation was cleared.",
  aborted: "A ping was cut short, so warming stopped until the session runs again.",
  expired: "The cache had already expired, so there was nothing left to keep warm.",
  timeout: "A ping got no answer within 2 minutes, so warming stopped until the session runs again.",
};

/**
 * What the alert adds under the countdown. A permission wait says why warming cannot help (it never pings then),
 * whatever the alert; the tip says how to turn warming on, or, when it is on and has stopped, why and what to do.
 */
function AlertDetail({ s, c }: { s: SessionView; c: CacheView }) {
  if (s.waitReason === "permission") {
    return <div className="wait-detail">It is waiting on a permission prompt. Cache warming only works while a session waits for your prompt.</div>;
  }
  if (c.alert !== "tip") return null;
  const w = c.warming;
  if (w.on && w.state === "stopped") {
    return (
      <div className="wait-detail">
        Cache warming has stopped. {w.stopReason ? STOP_TEXT[w.stopReason] : ""} To keep the cache, send that session a prompt before it expires; warming starts again the next time it waits.
      </div>
    );
  }
  if (w.on) return null;
  return (
    <div className="wait-detail">
      Keep it warm: run <code>/podium warm on</code> in that session, or turn on <code>cacheWarming</code> with <code>/plugin configure</code>.
    </div>
  );
}

/** The card's alert: a countdown, what going cold costs, and for the first two what to do about it. */
export function CacheAlertBox({ s, now }: { s: SessionView; now: number }) {
  const c = coolingCache(s);
  if (!c) return null;
  const cost = coldCostText(c);
  return (
    <div className="alert cache">
      <IconClock />
      <div>
        Prompt cache expires in <span className="mono">{fmtCountdown((c.expiresAt - now) / 1000)}</span>.{cost ? ` ${cost}` : ""}
        <AlertDetail s={s} c={c} />
      </div>
    </div>
  );
}

/** While warming is on: whether it keeps the cache warm or has stopped, with the pings sent and their estimated cost. */
export function WarmingChip({ cache }: { cache: CacheView | null }) {
  const w = cache?.warming;
  if (!w?.on) return null;
  const label = w.state === "stopped" ? "cache warming stopped" : w.state === "warming" ? "cache kept warm" : "cache warming on";
  const spent = w.pings ? ` · ${w.pings} ping${w.pings === 1 ? "" : "s"} · ${fmtUsd(w.costUsdEst)}` : "";
  const title =
    w.state === "stopped" && w.stopReason
      ? STOP_TEXT[w.stopReason]
      : "Cache warming is on: while the session waits on you, one small request about a minute before the prompt cache expires keeps it warm. The cost is an estimate.";
  return (
    <span className={`chip warming${w.state === "stopped" ? " warn" : ""}`} title={title}>
      {label}
      {spent}
    </span>
  );
}

/** The rail row's short form of the alert. */
export function RailCacheChip({ s, now }: { s: SessionView; now: number }) {
  const c = coolingCache(s);
  if (!c) return null;
  const left = fmtCountdown((c.expiresAt - now) / 1000);
  return (
    <span className="chip warn cache" title={`Prompt cache expires in ${left}`}>
      <IconClock />
      <span className="mono">{left}</span>
    </span>
  );
}

/** Shown while cooling alerts are off because they were ignored twice: says so, and turns them back on. */
export function CacheAlertsOff({ view, onReset }: { view: CacheAlertsView | null; onReset: () => void }) {
  if (!view?.suppressed) return null;
  return (
    <div className="fold cache-off">
      <b>Prompt cache alerts are off.</b>
      <span>Two were shown and nothing kept those caches warm.</span>
      <button type="button" className="link" onClick={onReset}>
        Turn cache alerts back on
      </button>
    </div>
  );
}
