export type Route = "history" | "admin" | "fleet";

/** `#/history` is the history view and `#/admin` the Admin section; every other hash (including the retired `#/usage`) is the fleet console. */
export function routeFor(hash: string): Route {
  if (hash === "#/admin" || hash.startsWith("#/admin/")) return "admin";
  return hash === "#/history" || hash.startsWith("#/history?") ? "history" : "fleet";
}
