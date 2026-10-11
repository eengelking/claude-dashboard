import { describe, it, expect } from "vitest";
import { fmtClock, fmtDur, fmtPct, fmtTok, fmtUsd, shortenHome } from "./format";

describe("fmtTok", () => {
  it("formats edge values", () => {
    expect(fmtTok(0)).toBe("0");
    expect(fmtTok(999)).toBe("999");
    expect(fmtTok(1000)).toBe("1.0k");
    expect(fmtTok(12_345)).toBe("12.3k");
    expect(fmtTok(123_456)).toBe("123k");
    expect(fmtTok(1_500_000)).toBe("1.50M");
    expect(fmtTok(null)).toBe("–");
    expect(fmtTok(-5)).toBe("0");
  });
});

describe("fmtUsd", () => {
  it("formats edge values", () => {
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(999)).toBe("$999");
    expect(fmtUsd(1000)).toBe("$1000");
    expect(fmtUsd(0.534)).toBe("$0.53");
    expect(fmtUsd(99.999)).toBe("$100.00");
    expect(fmtUsd(1_500_000)).toBe("$1500000");
    expect(fmtUsd(null)).toBe("–");
  });
});

describe("fmtDur", () => {
  it("formats edge values", () => {
    expect(fmtDur(0)).toBe("0:00");
    expect(fmtDur(999)).toBe("16:39");
    expect(fmtDur(1000)).toBe("16:40");
    expect(fmtDur(3599)).toBe("59:59");
    expect(fmtDur(3600)).toBe("1h 00m");
    expect(fmtDur(86_399)).toBe("23h 59m");
    expect(fmtDur(86_400)).toBe("1d 00h");
    expect(fmtDur(1_500_000)).toBe("17d 08h");
    expect(fmtDur(-3)).toBe("0:00");
  });
});

describe("fmtClock", () => {
  it("formats local time with zero padding", () => {
    const d = new Date(2026, 9, 10, 9, 5, 7);
    expect(fmtClock(d.getTime())).toBe("09:05:07");
    expect(fmtClock(new Date(2026, 9, 10, 0, 0, 0).getTime())).toBe("00:00:00");
    expect(fmtClock(new Date(2026, 9, 10, 23, 59, 59, 999).getTime())).toBe("23:59:59");
    expect(fmtClock(new Date(2026, 9, 10, 1, 0, 0).getTime() + 3600 * 1000)).toBe("02:00:00");
    expect(fmtClock(new Date(2026, 9, 10, 0, 0, 0).getTime() + 86_400 * 1000)).toBe("00:00:00");
  });
});

describe("fmtPct and shortenHome", () => {
  it("clamps and rounds percentages", () => {
    expect(fmtPct(41.4)).toBe("41%");
    expect(fmtPct(140)).toBe("100%");
    expect(fmtPct(null)).toBe("–");
  });
  it("shortens the home prefix only", () => {
    expect(shortenHome("/Users/a/dev", "/Users/a")).toBe("~/dev");
    expect(shortenHome("/Users/ab/dev", "/Users/a")).toBe("/Users/ab/dev");
  });
});
