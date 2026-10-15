import { describe, it, expect } from "vitest";
import { wallColumns } from "./wallLayout";

// The wall holds as many 360 px cards (12 px apart) as fit, at most four, and never more columns than cards.
// A lone card is half the wall when two columns fit (#145).
describe("wallColumns", () => {
  it("fits four from 1476 px, three from 1104, two from 732 and one below that", () => {
    expect(wallColumns(1476, 9)).toBe(4);
    expect(wallColumns(1475, 9)).toBe(3);
    expect(wallColumns(1104, 9)).toBe(3);
    expect(wallColumns(1103, 9)).toBe(2);
    expect(wallColumns(732, 9)).toBe(2);
    expect(wallColumns(731, 9)).toBe(1);
    expect(wallColumns(360, 9)).toBe(1);
  });

  it("never goes past four however wide the wall is", () => {
    expect(wallColumns(2400, 12)).toBe(4);
  });

  it("uses no more columns than there are cards", () => {
    expect(wallColumns(1600, 2)).toBe(2);
    expect(wallColumns(1600, 3)).toBe(3);
    expect(wallColumns(1600, 4)).toBe(4);
    expect(wallColumns(1600, 5)).toBe(4);
  });

  it("gives a lone card half the wall when two columns fit, and the full width otherwise", () => {
    expect(wallColumns(1600, 1)).toBe(2);
    expect(wallColumns(732, 1)).toBe(2);
    expect(wallColumns(731, 1)).toBe(1);
    expect(wallColumns(600, 1)).toBe(1);
  });

  it("measures a 1215 px wall as three columns and a 976 px wall as two", () => {
    expect(wallColumns(1215, 9)).toBe(3);
    expect(wallColumns(976, 9)).toBe(2);
  });

  it("handles an empty wall and an unmeasured one", () => {
    expect(wallColumns(1600, 0)).toBe(1);
    expect(wallColumns(0, 5)).toBe(1);
  });
});
