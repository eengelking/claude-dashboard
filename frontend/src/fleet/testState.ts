// Builds a FleetState for component tests without a server.
import { fleetReducer, initialState, type FleetState } from "./store";
import type { StateBody } from "./types";
import { makeState } from "./fixtures";

export function stateFrom(over: Partial<StateBody> = {}): FleetState {
  return fleetReducer(initialState, { type: "snapshot", body: makeState(over) });
}
