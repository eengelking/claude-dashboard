// How Admin learns that a browser is already signed in to respond as an Administrator (#215), so it opens without a
// second sign-in. The respond routes fill `administratorOf` in when they are mounted; the Admin router only asks it.
import type { Request } from 'express';

export interface RespondBridge {
  /** The Administrator a request's sign-in to respond belongs to (personId null for the admin secret), or null when it is not one. */
  administratorOf: (req: Request) => { personId: number | null } | null;
}

export const createRespondBridge = (): RespondBridge => ({ administratorOf: () => null });
