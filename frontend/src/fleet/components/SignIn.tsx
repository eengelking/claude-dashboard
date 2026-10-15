import { useId, useRef, useState } from "react";
import { useRespond, type SignInResult } from "../useRespond";
import { Modal } from "./Modal";

// Signing in to respond (#206, mockup/podium-respond.html section 6): a name and a token, the same pair as the
// reporter's userName and token options. The same form sits in the Activity modal's answer panel and in the top bar's
// small dialog. The token field is cleared after a wrong try and never kept.

export const SIGN_HINT = "Signs in this browser. An Admin can use the name Admin with the admin secret.";

const ERRORS: Record<Exclude<SignInResult, "ok">, string> = {
  wrong: "That name and token don't match. Check the userName and token options in podium-reporter.",
  empty: "Enter your name and your token.",
  locked: "Too many wrong tries from this address. Try again in 15 minutes.",
};

function SignInLead() {
  return (
    <p className="signlead">
      Use your name and token, the same ones as your podium-reporter's <code>userName</code> and <code>token</code> options. Only the session's owner, or an Admin, can respond.
    </p>
  );
}

/** The form's fields and error, and its submit; the caller lays out the footer around the button. */
function useSignInForm(onDone?: () => void) {
  const ctx = useRespond();
  const id = useId();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState<Exclude<SignInResult, "ok"> | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const locked = err === "locked";

  const submit = async () => {
    if (!ctx || busy) return;
    if (!name.trim() || !token) {
      setErr("empty");
      (name.trim() ? tokenRef : nameRef).current?.focus();
      return;
    }
    setBusy(true);
    const r = await ctx.signIn(name, token);
    setBusy(false);
    if (r === "ok") {
      setToken("");
      setErr(null);
      onDone?.();
      return;
    }
    setErr(r);
    // The name stays; the token is cleared. Which of the two was wrong is never said.
    setToken("");
    if (r !== "locked") tokenRef.current?.focus();
  };

  const fields = (
    <>
      <div className="signin">
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          ref={nameRef}
          type="text"
          autoComplete="username"
          spellCheck={false}
          value={name}
          disabled={locked}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <label htmlFor={`${id}-token`}>Token</label>
        <input
          id={`${id}-token`}
          ref={tokenRef}
          className="mono"
          type="password"
          autoComplete="off"
          value={token}
          disabled={locked}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>
      {err && (
        <div className="signerr" role="alert">
          {ERRORS[err]}
        </div>
      )}
    </>
  );
  const button = (
    <button className="btn pri" type="button" disabled={locked || busy} onClick={() => void submit()}>
      Sign in
    </button>
  );
  return { fields, button, nameRef, expired: ctx?.expired ?? false };
}

/** The answer panel's body and footer while signed out (mockup section 3, "Signing in"). */
export function SignInPanel() {
  const f = useSignInForm();
  return (
    <>
      <div className="ab">
        {f.expired && <p className="signnote">You were signed out. A sign-in ends after 12 hours without use, when the server restarts, and when your token changes.</p>}
        <p className="qh">Sign in to respond</p>
        <SignInLead />
        {f.fields}
      </div>
      <div className="af">
        <span className="grow">{SIGN_HINT}</span>
        {f.button}
      </div>
    </>
  );
}

/** The top bar's dialog: the same form, closing once signed in and leaving the page as it was. */
function SignInDialog(props: { onClose: () => void }) {
  const f = useSignInForm(props.onClose);
  return (
    <Modal titleId="signInTitle" title="Sign in" sub="To answer and message your own sessions" onClose={props.onClose} className="sm">
      <div className="sbody">
        <SignInLead />
        {f.fields}
      </div>
      <div className="sfoot">
        <span className="grow">{SIGN_HINT}</span>
        {f.button}
      </div>
    </Modal>
  );
}

/** The far right of the top bar, after a divider: Sign in, or who is signed in and Sign out (mockup section 6). */
export function TopBarSignIn() {
  const ctx = useRespond();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  if (!ctx?.me?.enabled) return null;
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  return (
    <>
      <span className="tb-sep" aria-hidden="true" />
      {ctx.me.signedIn ? (
        <span className="tb-me">
          <span className="tb-who">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="8" cy="5.5" r="2.7" />
              <path d="M2.8 13.5c.7-2.6 2.8-4 5.2-4s4.5 1.4 5.2 4" />
            </svg>
            Signed in as <b>{ctx.me.name}</b>
          </span>
          <button type="button" className="btn" onClick={() => void ctx.signOut()}>
            Sign out
          </button>
        </span>
      ) : (
        <button type="button" className="btn" ref={opener} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          Sign in
        </button>
      )}
      {open && !ctx.me.signedIn && <SignInDialog onClose={close} />}
    </>
  );
}
