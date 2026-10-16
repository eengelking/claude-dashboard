/**
 * Which Podium identity (name and token) a session reports as (#226).
 *
 * The reporter's options are one set per Claude config directory, so two terminals on one machine share
 * them, and Claude Code reloads every session's module when an option changes. Reading the options
 * live would turn a running session into whoever signed in last. So a session takes its identity once
 * and holds it (in `$.state`, which survives a reload); a terminal can name its own through
 * `PODIUM_USER` and `PODIUM_TOKEN`, which win over the shared options.
 */

export interface Identity {
  userName: string;
  token: string;
}

export interface EnvIdentity {
  user?: string;
  token?: string;
}

const hasAny = (i: Identity) => i.userName.trim() !== '' || i.token !== '';

/**
 * The identity to report as: the one the session already holds, else the terminal's environment (taken
 * whole when either variable is set, never mixed with the shared options), else the shared options.
 * An identity with neither a name nor a token is nothing to protect, so it is not held.
 */
export function pickIdentity(from: { held: Identity | undefined; env: EnvIdentity; options: Identity }): Identity {
  if (from.held && hasAny(from.held)) return from.held;
  const user = (from.env.user ?? '').trim();
  const token = from.env.token ?? '';
  if (user || token) return { userName: user, token };
  return { userName: from.options.userName, token: from.options.token };
}

/** Whether an identity is worth holding for the rest of the session. */
export function worthHolding(i: Identity): boolean {
  return hasAny(i);
}
