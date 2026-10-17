// How Admin learns that a browser is already signed in to respond as an Administrator (#215), so it opens without a
// second sign-in. The respond routes fill `administratorOf` in when they are mounted; the Admin router only asks it.
import type { Request } from 'express';

export interface RespondBridge {
  /** The Administrator a request's sign-in to respond belongs to (personId null for the admin secret), or null when it is not one. */
  administratorOf: (req: Request) => { personId: number | null } | null;
  /** Stops `administratorOf` answering for this request's sign-in until `release` or a new sign-in: an explicit Lock Admin (#272). */
  hold: (req: Request) => void;
  /** Lifts the hold, after the person proved who they are with a name and token; ignored when that is not the person signed in to respond here. */
  release: (req: Request, personId: number | null) => void;
}

export const createRespondBridge = (): RespondBridge => ({ administratorOf: () => null, hold: () => undefined, release: () => undefined });
