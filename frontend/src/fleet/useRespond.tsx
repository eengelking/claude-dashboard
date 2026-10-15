// Who is signed in to respond, and which session's modal is open (#206). One provider for the console: the cards, the
// orchestrator page, the Activity panel and the top bar all read it. The sign-in itself is an HttpOnly cookie; this
// only asks the server who it is (GET /respond/me) and never holds the token.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { respondApi, RespondError, type RespondApi } from "./respondApi";
import type { RespondMe } from "./types";

export type SignInResult = "ok" | "wrong" | "empty" | "locked";

export interface RespondContext {
  /** Null until the server has said, and when it can't be reached: then nothing about responding shows. */
  me: RespondMe | null;
  /** The Admin's respond and activity-feed flags, from the console's state. */
  flagsOn: boolean;
  /** A sign-in ended while the page was open (12 idle hours, a restart, a new token): the next form says so once. */
  expired: boolean;
  signIn: (name: string, token: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Asks the server again: after a refusal that says the sign-in is gone. */
  refresh: () => Promise<void>;
  /** The session whose Respond modal is open, and opening or closing it. */
  openFor: string | null;
  open: (sessionId: string, opener?: HTMLElement | null) => void;
  close: () => void;
  api: RespondApi;
}

const Ctx = createContext<RespondContext | null>(null);

/** The console's respond state; null outside the provider (History, tests), where nothing about responding shows. */
export function useRespond(): RespondContext | null {
  return useContext(Ctx);
}

/** How often the page checks the sign-in is still there, so an ended one is noticed before the next answer. */
const CHECK_MS = 60_000;

export function RespondProvider(props: { children: ReactNode; api?: RespondApi; flagsOn: boolean }) {
  const api = props.api ?? respondApi;
  const [me, setMe] = useState<RespondMe | null>(null);
  const [expired, setExpired] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const signedIn = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const m = await api.me();
      if (signedIn.current && !m.signedIn) setExpired(true);
      signedIn.current = m.signedIn;
      setMe(m);
    } catch {
      // The server is unreachable or predates responding: leave the last answer.
    }
  }, [api]);

  // Asked again when the Admin's flags flip, and once a minute.
  // With the Admin's flags off nobody can respond, so the server is not even asked.
  useEffect(() => {
    if (!props.flagsOn) {
      setMe(null);
      return;
    }
    void refresh();
    const t = setInterval(() => void refresh(), CHECK_MS);
    return () => clearInterval(t);
  }, [refresh, props.flagsOn]);

  const signIn = useCallback(
    async (name: string, token: string): Promise<SignInResult> => {
      if (!name.trim() || !token) return "empty";
      try {
        await api.signIn(name.trim(), token);
        setExpired(false);
        await refresh();
        return "ok";
      } catch (err) {
        if (err instanceof RespondError && err.status === 429) return "locked";
        if (err instanceof RespondError && err.status === 400) return "empty";
        return "wrong";
      }
    },
    [api, refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      signedIn.current = false;
      setExpired(false);
      await refresh();
    }
  }, [api, refresh]);

  const open = useCallback((sessionId: string, from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    setOpenFor(sessionId);
  }, []);
  const close = useCallback(() => {
    setOpenFor(null);
    opener.current?.focus();
  }, []);

  const flagsOn = props.flagsOn;
  const value = useMemo<RespondContext>(() => ({ me, flagsOn, expired, signIn, signOut, refresh, openFor, open, close, api }), [me, flagsOn, expired, signIn, signOut, refresh, openFor, open, close, api]);
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
