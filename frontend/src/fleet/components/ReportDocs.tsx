import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reporterBelow } from "../logic";
import type { AgentView, SessionView } from "../types";
import { Markdown } from "./Markdown";

// The agent panel's Report group: two buttons that open the task prompt and the final answer in a
// modal, rendered as markdown (issue #97, mockup/podium-prompt-modal.html). The full text is fetched
// when a modal opens; it is not part of the state the server streams.

type Kind = "prompt" | "answer";
export interface AgentTexts {
  prompt: string | null;
  answer: string | null;
}
export type FetchText = (sessionId: string, agentId: string) => Promise<AgentTexts>;

export const FULL_TEXT_REPORTER_MINOR = 10;

const defaultFetchText: FetchText = async (sessionId, agentId) => {
  const res = await fetch(`/api/fleet/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/text`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AgentTexts;
};

const TITLE: Record<Kind, string> = { prompt: "Task prompt", answer: "Final answer" };

type Load = { state: "idle" } | { state: "loading" } | { state: "ready"; texts: AgentTexts } | { state: "failed" };

function chars(a: AgentView, kind: Kind): number {
  return (kind === "prompt" ? a.promptChars : a.answerChars) ?? 0;
}
function excerptOf(a: AgentView, kind: Kind): string {
  return (kind === "prompt" ? a.promptExcerpt : a.answerExcerpt) ?? "";
}

function DocButton(props: { kind: Kind; a: AgentView; onOpen: (kind: Kind, from: HTMLButtonElement) => void }) {
  const { kind, a } = props;
  const full = chars(a, kind);
  const has = full > 0 || excerptOf(a, kind) !== "";
  const unfinished = kind === "answer" && (a.status === "running" || a.status === "queued");
  const meta = full > 0 ? `${full.toLocaleString("en-US")} chars` : has ? "excerpt only" : unfinished ? "not finished" : "not reported";
  return (
    <button type="button" className="docbtn" disabled={!has} aria-haspopup="dialog" onClick={(e) => props.onOpen(kind, e.currentTarget)}>
      <svg className="ic" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        {kind === "prompt" ? (
          <>
            <path d="M3 2.5h7l3 3v8H3z" />
            <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" />
          </>
        ) : (
          <>
            <circle cx="8" cy="8" r="5.5" />
            <path d="m5.5 8.2 1.8 1.8 3.3-3.6" />
          </>
        )}
      </svg>
      <span className="t">{TITLE[kind]}</span>
      <span className="m">{meta}</span>
    </button>
  );
}

export function ReportDocs(props: { s: SessionView; a: AgentView; fetchText?: FetchText }) {
  const { s, a } = props;
  const fetchText = props.fetchText ?? defaultFetchText;
  const [open, setOpen] = useState<Kind | null>(null);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const opener = useRef<HTMLButtonElement | null>(null);
  const fetchRef = useRef(fetchText);
  fetchRef.current = fetchText;
  const request = useRef(0);

  const onOpen = useCallback(
    (kind: Kind, from: HTMLButtonElement) => {
      opener.current = from;
      setOpen(kind);
      if (chars(a, kind) > 0) {
        const mine = ++request.current;
        setLoad({ state: "loading" });
        fetchRef.current(s.id, a.id).then(
          (texts) => mine === request.current && setLoad({ state: "ready", texts }),
          () => mine === request.current && setLoad({ state: "failed" }),
        );
      } else {
        request.current++;
        setLoad({ state: "idle" });
      }
    },
    [s.id, a.id, a],
  );

  const close = useCallback(() => {
    request.current++;
    setOpen(null);
    setLoad({ state: "idle" });
    opener.current?.focus();
  }, []);

  // A different agent selected under an open modal closes it.
  useEffect(() => {
    setOpen(null);
    setLoad({ state: "idle" });
  }, [s.id, a.id]);

  return (
    <>
      <span className="lab">Report</span>
      <div className="docbtns">
        <DocButton kind="prompt" a={a} onOpen={onOpen} />
        <DocButton kind="answer" a={a} onOpen={onOpen} />
      </div>
      {open && <DocModal kind={open} s={s} a={a} load={load} onClose={close} />}
    </>
  );
}

function DocModal(props: { kind: Kind; s: SessionView; a: AgentView; load: Load; onClose: () => void }) {
  const { kind, s, a, load } = props;
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  const fullText = load.state === "ready" ? load.texts[kind] : null;
  const excerpt = excerptOf(a, kind);
  const text = fullText ?? excerpt;
  const isExcerpt = fullText === null && load.state !== "loading";

  useEffect(() => {
    document.body.classList.add("modal-open");
    closeBtn.current?.focus();
    // While the modal is open the page behind it gets no keys: Esc closes the modal (and does not leave
    // wall mode), Tab stays inside, and the shell shortcuts are off.
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onClose.current();
      } else if (e.key === "Tab") {
        const f = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']") ?? [])];
        const first = f[0];
        const last = f[f.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("modal-open");
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // no clipboard here: the button just does nothing
    }
  };

  let note: string | null = null;
  if (load.state === "failed") note = "Could not load the full text. Showing the first 400 characters.";
  else if (isExcerpt && excerpt) {
    note = "Showing the first 400 characters.";
    if (s.reporter === "mod") {
      note += reporterBelow(s, FULL_TEXT_REPORTER_MINOR)
        ? ` The full text needs podium-reporter 0.10.0 or later. This session reports ${s.reporterVersion}. Run claude plugin update podium-reporter@eengelking-marketplace, then /reload-plugins in that session.`
        : " To see the full text, turn on the fullPrompts option (Send full prompts and answers) of podium-reporter.";
    }
  }

  return createPortal(
    <div className="podium podium-modal">
      <div
        className="scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reportTitle" ref={dialog}>
          <div className="mh">
            <div className="ttl">
              <h2 id="reportTitle">{TITLE[kind]}</h2>
              <div className="sub2">
                {a.description} · {a.type}
              </div>
            </div>
            <button type="button" className="copy" onClick={copy} disabled={!text}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="x" ref={closeBtn} onClick={props.onClose} aria-label="Close (Esc)">
              ✕
            </button>
          </div>
          <div className="mb" tabIndex={0}>
            {load.state === "loading" ? <p className="muted">Loading…</p> : text ? <Markdown source={text} /> : <p className="muted">Not available.</p>}
            {note && <p className="mnote">{note}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
