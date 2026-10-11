import { describe, it, expect } from "vitest";
import { areaPoints, indexAt, seriesPoints, xOf } from "./chart";

describe("seriesPoints", () => {
  it("draws a flat bottom line for an empty series", () => {
    expect(seriesPoints([], 100, 22)).toBe("0,20.0 100,20.0");
  });
  it("draws a flat line across for a single point", () => {
    expect(seriesPoints([5], 100, 22, 10)).toBe("0,11.0 100,11.0");
  });
  it("keeps all-zero series on the bottom", () => {
    expect(seriesPoints([0, 0, 0], 100, 22)).toBe("0.0,20.0 50.0,20.0 100.0,20.0");
  });
  it("scales the maximum to the top and clamps to a fixed max", () => {
    expect(seriesPoints([0, 5, 10], 120, 44)).toBe("0.0,42.0 60.0,22.0 120.0,2.0");
    expect(seriesPoints([0, 2, 4], 120, 44, 1)).toBe("0.0,42.0 60.0,2.0 120.0,2.0");
    expect(seriesPoints([0.5], 120, 44, 1)).toBe("0,22.0 120,22.0");
  });
  it("closes the area along the bottom", () => {
    expect(areaPoints([1, 1], 10, 10)).toBe("0.0,2.0 10.0,2.0 10,10 0,10");
  });
  it("maps indexes and pointer positions", () => {
    expect(xOf(59, 60, 120)).toBe(120);
    expect(xOf(0, 1, 120)).toBe(0);
    expect(indexAt(50, 0, 100, 60)).toBe(30);
    expect(indexAt(-20, 0, 100, 60)).toBe(0);
    expect(indexAt(500, 0, 100, 60)).toBe(59);
  });
});
