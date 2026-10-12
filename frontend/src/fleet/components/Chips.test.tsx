import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EffortMeter } from "./Chips";
import { EFFORTS } from "../logic";

afterEach(cleanup);

describe("EffortMeter", () => {
  it.each(EFFORTS)("shows %s as a colored meter with no text, named for screen readers", (level) => {
    const { container } = render(<EffortMeter effort={level} />);
    const eff = container.querySelector(".eff")!;
    expect(eff.textContent).toBe("");
    expect(screen.getByRole("img", { name: `Effort: ${level}` })).toBe(eff);
    expect(eff).toHaveClass(`eff-${level}`);
    expect(eff).toHaveAttribute("title", `Effort: ${level}`);
    expect(eff.querySelectorAll("b.on")).toHaveLength(EFFORTS.indexOf(level) + 1);
    expect(eff.querySelectorAll("b")).toHaveLength(5);
  });

  it("gives each level its own style hook", () => {
    const classes = EFFORTS.map((l) => {
      const { container, unmount } = render(<EffortMeter effort={l} />);
      const c = container.querySelector(".eff")!.className;
      unmount();
      return c;
    });
    expect(new Set(classes).size).toBe(EFFORTS.length);
  });

  it("dims the meter and says so when no effort was reported", () => {
    const { container } = render(<EffortMeter effort={null} />);
    const eff = container.querySelector(".eff")!;
    expect(eff.textContent).toBe("");
    expect(screen.getByRole("img", { name: "Effort not reported" })).toBe(eff);
    expect(eff).toHaveClass("eff-none");
    expect(eff.querySelectorAll("b.on")).toHaveLength(0);
  });

  it("treats a level it does not know as not reported", () => {
    const { container } = render(<EffortMeter effort="turbo" />);
    const eff = container.querySelector(".eff")!;
    expect(eff).toHaveClass("eff-none");
    expect(eff).toHaveAttribute("title", "Effort not reported");
    expect(eff.textContent).toBe("");
  });
});
