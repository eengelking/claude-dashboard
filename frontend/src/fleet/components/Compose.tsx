import { useState, type KeyboardEvent } from "react";
import { ASK_WORD, COMMANDS } from "../respond";
import type { AskKind } from "../types";

// The message box at the bottom of the Activity modal (#206, mockup/podium-respond.html section 3, "Its turn ended"):
// a new message, a message in place of an open ask's answer, or /clear (after a confirmation) and /compact.

/** The note in place of the message box when responding is off, or when this session's reporter can't answer. */
export function OffNote(props: { edge: "off" | "old"; reporterVersion: string | null }) {
  if (props.edge === "off") {
    return (
      <div className="offnote">
        <b>Responding from Podium is turned off.</b>
        <span>
          The Admin's Respond from Podium switch, this session's <code>respond</code> option, or the activity feed is off. Answer in the terminal or desktop app. Admin &gt; Settings &gt; Feature flags has the server's switch.
        </span>
      </div>
    );
  }
  return (
    <div className="offnote">
      <b>This session can't be answered from Podium.</b>
      <span>
        It reports with podium-reporter {props.reporterVersion ?? "older than 0.14.0"}. Responding needs a newer reporter with the <code>respond</code> option on: run{" "}
        <code>claude plugin update podium-reporter@eengelking-marketplace</code>, then <code>/reload-plugins</code> in that session. Sessions reported by the settings hooks or run with <code>claude -p</code> can't be answered at all.
      </span>
    </div>
  );
}

export function Compose(props: {
  name: string;
  /** The open ask a message would replace, when its form is showing; null while the session's turn has ended. */
  pending: AskKind | null;
  draft: string;
  onDraft: (t: string) => void;
  confirmClear: boolean;
  onConfirmClear: (on: boolean) => void;
  /** Sends the draft: a message, a reply in place of the ask's answer, or a command. */
  onSend: (text: string) => void;
  error: string | null;
  busy: boolean;
}) {
  const [ta, setTa] = useState(0);
  const val = props.draft;
  const slash = val.startsWith("/") ? (val.split(/\s/)[0] ?? "") : null;
  const known = slash !== null && COMMANDS.some((c) => c.name === slash);
  const matches = slash !== null && !val.includes(" ") && !known ? COMMANDS.filter((c) => c.name.startsWith(slash)) : [];
  const pending = props.pending;

  let extra = null;
  if (props.confirmClear) {
    extra = (
      <div className="confirm" role="alertdialog" aria-label="Clear the conversation?">
        <span>
          <b>Clear the conversation?</b> {props.name} starts over with an empty context. Podium shows the cleared part as its own session in History, linked to this one.
        </span>
        <span className="acts">
          <button className="btn" type="button" onClick={() => props.onConfirmClear(false)}>
            Cancel
          </button>
          <button
            className="btn bad"
            type="button"
            autoFocus
            onClick={() => {
              props.onConfirmClear(false);
              props.onSend("/clear");
            }}
          >
            Clear conversation
          </button>
        </span>
      </div>
    );
  } else if (slash && !known && val.length > 1 && !matches.length) {
    extra = <div className="err">{slash} runs only in the terminal. From here you can send /clear and /compact.</div>;
  } else if (pending && val.trim() && !slash) {
    extra = <div className="warnline">Sending this closes the {ASK_WORD[pending]} without an answer and gives Claude your message instead, like "Chat about this" in the terminal.</div>;
  }

  const send = () => {
    const text = val.trim();
    if (!text || props.busy) return;
    if (text === "/clear") {
      props.onConfirmClear(true);
      return;
    }
    if (text.startsWith("/") && !COMMANDS.some((c) => c.name === text)) return;
    props.onSend(text);
  };
  const choose = (name: string) => {
    props.onDraft(name);
    setTa(0);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setTa((n) => (n + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
      return;
    }
    if (matches.length && (e.key === "Tab" || e.key === "Enter")) {
      e.preventDefault();
      choose(matches[Math.min(ta, matches.length - 1)]!.name);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  const placeholder = pending ? (pending === "question" ? "Chat about this instead of answering" : "Reply instead, for example: hold off, I want to look first") : `Message ${props.name}, or type / for a command`;
  return (
    <div className="compose">
      {matches.length > 0 && !props.confirmClear && (
        <div className="typeahead" role="listbox" aria-label="Commands">
          {matches.map((m, i) => (
            <button key={m.name} type="button" role="option" aria-selected={i === ta} className={i === ta ? "on" : ""} onClick={() => choose(m.name)}>
              <span className="cn">{m.name}</span>
              <span className="cd">{m.desc}</span>
            </button>
          ))}
          <div className="tf">Other commands run only in the terminal.</div>
        </div>
      )}
      {extra}
      {props.error && (
        <div className="err" role="alert">
          {props.error}
        </div>
      )}
      <div className="crow">
        <textarea
          rows={1}
          placeholder={placeholder}
          aria-label={`Message to ${props.name}`}
          value={val}
          data-keeps-tab={matches.length ? "" : undefined}
          onChange={(e) => {
            props.onDraft(e.target.value);
            setTa(0);
          }}
          onKeyDown={onKey}
        />
        <button className="btn pri" type="button" disabled={!val.trim() || props.busy} onClick={send}>
          Send
        </button>
      </div>
      <div className="hint">
        <span>Sent as you, through podium-reporter. The session reads it as a message from Podium.</span>
        <span>Enter sends · Shift+Enter for a new line</span>
      </div>
    </div>
  );
}
