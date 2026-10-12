import { describe, expect, it } from "vitest";
import { checkReporter, REPORTER_SUPPORT, serverVersion } from "./compat.js";

const support = { min: "0.2.0", max: "0.3.0" };

describe("checkReporter", () => {
  it("accepts a version inside the range", () => {
    expect(checkReporter("0.2.0", support)).toBe("ok");
    expect(checkReporter("0.3.0", support)).toBe("ok");
  });

  it("ignores the patch number, so a mod-only fix never warns", () => {
    expect(checkReporter("0.2.7", support)).toBe("ok");
    expect(checkReporter("0.3.9", support)).toBe("ok");
  });

  it("flags a reporter below the minimum as outdated", () => {
    expect(checkReporter("0.1.0", support)).toBe("outdated");
    expect(checkReporter("0.1.99", support)).toBe("outdated");
  });

  it("flags a reporter above the maximum as newer than the server", () => {
    expect(checkReporter("0.4.0", support)).toBe("newer");
    expect(checkReporter("1.0.0", support)).toBe("newer");
  });

  it("compares numerically, not as strings", () => {
    expect(checkReporter("0.10.0", support)).toBe("newer");
  });

  it("reports unknown for versions it cannot read", () => {
    expect(checkReporter("0.1.0-sim", support)).toBe("unknown");
    expect(checkReporter("hooks", support)).toBe("unknown");
    expect(checkReporter("", support)).toBe("unknown");
    expect(checkReporter(null, support)).toBe("unknown");
  });
});

describe("REPORTER_SUPPORT", () => {
  it("is a readable range with min at or below max", () => {
    expect(checkReporter(REPORTER_SUPPORT.min)).toBe("ok");
    expect(checkReporter(REPORTER_SUPPORT.max)).toBe("ok");
  });
});

describe("serverVersion", () => {
  it("reads the version from server/package.json", () => {
    expect(serverVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
