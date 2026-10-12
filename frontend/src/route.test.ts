import { describe, expect, it } from "vitest";
import { routeFor } from "./route";

describe("routeFor", () => {
  it("opens the history view for #/history, with or without a query", () => {
    expect(routeFor("#/history")).toBe("history");
    expect(routeFor("#/history?day=2026-10-10")).toBe("history");
  });

  it("opens the fleet console for #/, an empty hash and anything unknown", () => {
    expect(routeFor("")).toBe("fleet");
    expect(routeFor("#/")).toBe("fleet");
    expect(routeFor("#/nope")).toBe("fleet");
  });

  it("lands the retired #/usage page on the fleet console", () => {
    expect(routeFor("#/usage")).toBe("fleet");
    expect(routeFor("#/usage?x=1")).toBe("fleet");
  });
});
