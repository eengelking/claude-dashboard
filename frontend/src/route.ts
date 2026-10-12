export type Route = "history" | "fleet";

/** `#/history` is the history view; every other hash (including the retired `#/usage`) is the fleet console. */
export function routeFor(hash: string): Route {
  return hash === "#/history" || hash.startsWith("#/history?") ? "history" : "fleet";
}
