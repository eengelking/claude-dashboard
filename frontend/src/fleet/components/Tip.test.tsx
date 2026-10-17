import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tip } from "./Tip";

afterEach(cleanup);

describe("Tip", () => {
  it("shows its text on keyboard focus and hides it on blur (issue #275)", () => {
    render(<Tip text="Last heard 3 s ago">Silent</Tip>);
    const trigger = screen.getByText("Silent");
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip).not.toBeVisible();
    fireEvent.focus(trigger);
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent("Last heard 3 s ago");
    fireEvent.blur(trigger);
    expect(tip).not.toBeVisible();
  });

  it("shows on hover and hides on mouse leave", () => {
    render(<Tip text="Why">Trigger</Tip>);
    const trigger = screen.getByText("Trigger");
    const tip = screen.getByRole("tooltip", { hidden: true });
    fireEvent.mouseEnter(trigger);
    expect(tip).toBeVisible();
    fireEvent.mouseLeave(trigger);
    expect(tip).not.toBeVisible();
  });

  it("closes on Escape while the trigger keeps focus", () => {
    render(<Tip text="Why">Trigger</Tip>);
    const trigger = screen.getByText("Trigger");
    const tip = screen.getByRole("tooltip", { hidden: true });
    fireEvent.focus(trigger);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(tip).not.toBeVisible();
  });

  it("closes on Escape when opened by hover alone", () => {
    render(<Tip text="Why">Trigger</Tip>);
    const tip = screen.getByRole("tooltip", { hidden: true });
    fireEvent.mouseEnter(screen.getByText("Trigger"));
    expect(tip).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(tip).not.toBeVisible();
  });

  it("is focusable and described by the tooltip text, so a screen reader reads it without the tooltip open", () => {
    render(<Tip text="Keeps the parent’s context">Fork</Tip>);
    const trigger = screen.getByText("Fork");
    expect(trigger).toHaveAttribute("tabindex", "0");
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
    expect(trigger).toHaveAccessibleDescription("Keeps the parent’s context");
  });

  it("passes className and style to the trigger", () => {
    render(<Tip text="x" className="kind" style={{ color: "red" }}>K</Tip>);
    const trigger = screen.getByText("K");
    expect(trigger).toHaveClass("tip", "kind");
    expect(trigger).toHaveStyle({ color: "rgb(255, 0, 0)" });
  });
});
