import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ContextBar, Cost, EffortMeter, ModelChip, NO_PRICE_TITLE, StatusChip } from "./Chips";
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

describe("a model that is not a Claude model (#66)", () => {
  it("labels the chip with the raw model name and says it is not a Claude model", () => {
    render(<ModelChip family="other" model="llama3.1:8b" />);
    const chip = screen.getByText("llama3.1:8b").closest(".chip")!;
    expect(chip).toHaveAttribute("title", "llama3.1:8b (not a Claude model)");
  });

  it("reads n/a with the reason instead of a dollar figure when there is no price", () => {
    render(<Cost usd={null} family="other" />);
    expect(screen.getByText("n/a")).toHaveAttribute("title", NO_PRICE_TITLE);
  });

  it("still shows a Claude model's cost, and a dash when a Claude model has none yet", () => {
    const { container } = render(<><Cost usd={1.5} family="sonnet" /> <Cost usd={null} family="sonnet" /></>);
    expect(container.textContent).toBe("$1.50 –");
  });

  it("marks an unknown context window instead of drawing an empty bar", () => {
    render(<ContextBar percent={null} blowouts={0} />);
    const bar = screen.getByRole("img", { name: "Context unknown" });
    expect(bar).toHaveAttribute("title", "Context window unknown");
  });
});


describe("StatusChip delegating variant (#98)", () => {
  it("says delegating with a ring dot, the detail as tooltip and screen-reader text, and none of the amber classes", () => {
    const text = "Waiting on 2 agents: A, B. Not waiting on you.";
    const { container } = render(<StatusChip status="running" delegating={text} />);
    const st = container.querySelector(".st")!;
    expect(st).toHaveClass("deleg");
    expect(st).not.toHaveClass("running");
    expect(st).not.toHaveClass("waiting");
    expect(st).toHaveAttribute("title", text);
    expect(st).toHaveAttribute("aria-label", `delegating. ${text}`);
    expect(st.textContent).toBe("delegating");
    expect(st.querySelector(".dot.ring")).toBeInTheDocument();
    expect(st.querySelector(".dot.waiting")).toBeNull();
  });

  it("is unchanged without it", () => {
    const { container } = render(<StatusChip status="running" />);
    expect(container.querySelector(".st")).toHaveClass("running");
    expect(container.querySelector(".st")!.textContent).toBe("running");
  });
});
