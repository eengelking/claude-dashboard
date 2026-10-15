import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { reporterBelow } from "../logic";
import type { ActivityEntryView, SessionView } from "../types";
import { EVERY_CHOICES, readEvery, useActivityFeed, writeEvery, type FeedState, type FetchActivity } from "../useActivityFeed";
import { Modal } from "./Modal";
import { useRespond } from "../useRespond";

// The Activity section of the agent and orchestrator panels (#118, mockup/podium-agent-feed.html): the loop's recent
// tool calls and the text it writes, newest at the bottom, fetched on the viewer's interval while the panel is open.
// Expand opens the same feed in the console's modal. Entries are reported text and are drawn as text nodes only.
// When the Admin has turned the feed off (Admin > Settings > Feature flags, mockup/podium-feature-flags.html) the section
// says so instead, ahead of any note about the reporter, and keeps checking so it comes back when the flag is on again.

export const ACTIVITY_REPORTER_MINOR = 13;
const UPDATE = "Run claude plugin update podium-reporter@eengelking-marketplace, then /reload-plugins in that session.";

const ICON_TOOL = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="m3 4 4 4-4 4M8.5 12.5H13" />
  </svg>
);
const ICON_TEXT = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 4.5h10M3 8h10M3 11.5h6" />
  </svg>
);
const ICON_REASONING = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="8" cy="7" r="4.5" />
    <path d="M6 13.5h4" />
  </svg>
);
const ICON_EXPAND = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </svg>
);
const ICON_YOU = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="8" cy="5.5" r="2.7" />
    <path d="M2.8 13.5c.7-2.6 2.8-4 5.2-4s4.5 1.4 5.2 4" />
  </svg>
);
const KIND: Record<ActivityEntryView["kind"], { label: string; icon: JSX.Element; cls: string }> = {
  tool: { label: "Tool call", icon: ICON_TOOL, cls: "tool" },
  text: { label: "Text", icon: ICON_TEXT, cls: "txt" },
  reasoning: { label: "Reasoning", icon: ICON_REASONING, cls: "txt" },
  podium: { label: "Sent from Podium", icon: ICON_YOU, cls: "you" },
};

/** The note shown in the panel, and in its modal, while the Admin has the feed turned off. */
function AdminOffNote() {
  return (
    <div className="feedoff">
      <b>The activity feed is turned off by the Admin.</b>
      <div className="ghost">Someone with Admin access can turn it back on in Admin &gt; Settings &gt; Feature flags. Nothing is fetched or kept while it is off.</div>
    </div>
  );
}

/** Time since the loop started, `mm:ss` (or `h:mm:ss`), as the feed's left column shows it. */
export function feedTime(at: number, startedAt: number): string {
  const s = Math.max(0, Math.floor((at - startedAt) / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** The text with each `[redacted]` the mod put in marked, as text nodes. */
function Redacted(props: { text: string }) {
  const parts = props.text.split("[redacted]");
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span className="rd">[redacted]</span>}
        </span>
      ))}
    </>
  );
}

/** Who sent an answer or message from Podium, as the feed names them: "You" for the signed-in person (#206). */
function senderOf(by: string | undefined, me: string | null): string {
  const key = (n: string) => n.trim().toLowerCase();
  if (!by) return "Someone";
  return me && key(by) === key(me) ? "You" : by;
}

function Entry(props: { e: ActivityEntryView; startedAt: number; fresh: boolean }) {
  const { e } = props;
  const k = KIND[e.kind];
  const respond = useRespond();
  const me = respond?.me?.signedIn ? respond.me.name : null;
  const space = e.text.indexOf(" ");
  const name = e.kind === "tool" ? (space < 0 ? e.text : e.text.slice(0, space)) : "";
  const arg = e.kind === "tool" && space >= 0 ? e.text.slice(space + 1) : "";
  return (
    <li className={`${k.cls}${props.fresh ? " new" : ""}`}>
      <span className="at" title={new Date(e.at).toLocaleTimeString()}>
        {feedTime(e.at, props.startedAt)}
      </span>
      <span className="k" role="img" aria-label={k.label} title={k.label}>
        {k.icon}
      </span>
      <span className="body">
        {e.kind === "tool" ? (
          <>
            <span className="name">{name}</span> <span className="arg"><Redacted text={arg} /></span>
          </>
        ) : e.kind === "podium" ? (
          <>
            <span className="who">{senderOf(e.by, me)}, from Podium:</span> {e.text}
            {e.note && <span className="q"> {e.note}</span>}
          </>
        ) : (
          <Redacted text={e.text} />
        )}
      </span>
    </li>
  );
}

/** The list with its follow-the-latest behaviour: it stays at the bottom until the viewer scrolls up, and a pill brings it back. */
export function FeedList(props: { feed: FeedState; startedAt: number; empty: string }) {
  const list = useRef<HTMLOListElement>(null);
  const [following, setFollowing] = useState(true);
  const lastSeq = useRef(0);
  const entries = props.feed.entries;
  const newestSeq = entries.length ? entries[entries.length - 1]!.seq : 0;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [newestSeq, following]);
  useEffect(() => {
    lastSeq.current = newestSeq;
  }, [newestSeq]);

  const onScroll = () => {
    const el = list.current;
    if (el) setFollowing(el.scrollTop + el.clientHeight >= el.scrollHeight - 6);
  };
  const jump = () => {
    setFollowing(true);
    list.current?.focus();
  };

  return (
    <div className="feedwrap">
      <ol className="feed" ref={list} aria-label="Recent activity, newest last" tabIndex={0} onScroll={onScroll}>
        {entries.length ? entries.map((e) => <Entry key={e.seq} e={e} startedAt={props.startedAt} fresh={e.seq > lastSeq.current && lastSeq.current > 0} />) : <li className="empty">{props.empty}</li>}
      </ol>
      {!following && (
        <button type="button" className="jump" onClick={jump}>
          Jump to latest
        </button>
      )}
    </div>
  );
}

export function EverySelect(props: { id: string; every: number; onChange: (n: number) => void }) {
  return (
    <span className="live">
      <label htmlFor={props.id} className="sub">
        Refresh every
      </label>
      <select id={props.id} aria-label="Refresh interval" value={props.every} onChange={(e) => props.onChange(Number(e.target.value))}>
        {EVERY_CHOICES.map((n) => (
          <option key={n} value={n}>
            {n}s
          </option>
        ))}
      </select>
    </span>
  );
}

/** The status row under the feed: each text on one line, the count cut with an ellipsis (its full text is the tooltip). */
export function FeedStatus(props: { count: string; when: string }) {
  return (
    <div className="feedfoot stat">
      <span className="count" title={props.count}>{props.count}</span>
      <span className="when">{props.when}</span>
    </div>
  );
}

export function footer(feed: FeedState, active: boolean, isMain: boolean, now: number): [string, string] {
  const count = feed.seen === 0 ? "Nothing yet" : `Last ${feed.entries.length} of ${feed.seen} since you started watching`;
  let when: string;
  if (!feed.live) when = "No more updates";
  else if (!active) when = isMain ? "Session ended, no more updates" : "Agent finished, no more updates";
  else if (feed.failed) when = "Could not reach the server, retrying";
  else if (feed.fetchedAt === null) when = "Starting";
  else {
    const ago = Math.max(0, Math.round((now - feed.fetchedAt) / 1000));
    // The same wording from the first second: "just now" is wider than "3s ago" and made the footer reflow every tick.
    when = `Updated ${ago}s ago`;
  }
  return [count, when];
}

/**
 * The Activity section for one loop: an agent's id, or MAIN_LOOP for the orchestrator. `active` is whether the loop
 * is still working; `now` ticks once a second for the "Updated" line. `adminOn` is the Admin's `activity-feed` flag from
 * the console's state (left out where the state is not at hand, as in History: the route's reply says it then).
 */
export function ActivityFeed(props: { s: SessionView; loop: string; title: string; startedAt: number; active: boolean; now: number; isMain?: boolean; adminOn?: boolean; fetchActivity?: FetchActivity }) {
  const { s, active } = props;
  const old = s.reporter === "mod" && reporterBelow(s, ACTIVITY_REPORTER_MINOR);
  const enabled = s.reporter === "mod" && !old && s.activityFeed !== false;
  const [every, setEvery] = useState(readEvery);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const feed = useActivityFeed({ sessionId: s.id, loop: props.loop, enabled, active, every, adminOn: props.adminOn, fetchActivity: props.fetchActivity });
  const respond = useRespond();

  const pick = useCallback((n: number) => {
    setEvery(n);
    writeEvery(n);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus();
  }, []);

  if (s.reporter !== "mod") return null;
  // The Admin's switch wins over the reporter's option: with it off, nothing would show even with the option on.
  const adminOff = props.adminOn === false || feed.adminOff;
  const who = props.isMain ? "the orchestrator works" : "the agent works";
  if (!adminOff && (old || s.activityFeed === false)) {
    return (
      <>
        <span className="lab">Activity</span>
        <div className="feedoff">
          <b>Recent tool calls and text appear here while {who}.</b>
          <div className="ghost">
            {old ? (
              `The activity feed needs podium-reporter 0.13.0 or later. This session reports ${s.reporterVersion}. ${UPDATE}`
            ) : (
              <>
                Turn on the <code>activityFeed</code> option (Send an agent’s recent activity) of podium-reporter to see them: in Claude Code, run <code>/plugin configure podium-reporter@eengelking-marketplace</code>. Each entry is redacted and cut to 300 characters before it is sent.
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  const empty = !feed.live
    ? "This session is no longer live. Activity is kept only while someone watches a running session."
    : active
      ? "Watching from now. Earlier activity is not kept, and nothing is kept after you close this."
      : `${props.isMain ? "The session has ended" : "This agent has finished"}. Activity is kept only while someone watches it run.`;
  // Date.now() rather than `now` for "Updated": fetchedAt is this browser's time. `now` ticking re-renders it.
  const [count, when] = footer(feed, active, !!props.isMain, Date.now());

  // The modal stays in one place in the tree, so one that is open when the flag flips keeps its focus and only swaps
  // its content for the note.
  return (
    <>
      {adminOff ? (
        <>
          <span className="lab">Activity</span>
          <AdminOffNote />
        </>
      ) : (
        <>
          <div className="lab feedlab">
            <span className="tools">
              <span>Activity</span>
              <button
                type="button"
                className="expand"
                ref={opener}
                aria-haspopup="dialog"
                // The orchestrator's Expand opens the Respond modal (#206): the same feed, with the answer panel and the message box.
                onClick={() => (props.isMain && respond ? respond.open(s.id, opener.current) : setOpen(true))}
              >
                {ICON_EXPAND}
                Expand
              </button>
            </span>
            {active && <EverySelect id={`every-${props.loop}`} every={every} onChange={pick} />}
          </div>
          <FeedList feed={feed} startedAt={props.startedAt} empty={empty} />
          <FeedStatus count={count} when={when} />
          <div className="feedfoot">
            <span>Kept only while someone is watching. Closing this clears it. Secrets are removed before they leave the session.</span>
          </div>
        </>
      )}
      {open && (
        <Modal titleId="activityTitle" title="Activity" sub={props.title} onClose={close} className="modal-feed" actions={active && !adminOff ? <EverySelect id={`every-m-${props.loop}`} every={every} onChange={pick} /> : undefined}>
          <div className="mb feedmb">
            {adminOff ? (
              <AdminOffNote />
            ) : (
              <>
                <FeedList feed={feed} startedAt={props.startedAt} empty={empty} />
                <FeedStatus count={count} when={when} />
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
