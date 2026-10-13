import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TopBar } from "./TopBar";

afterEach(cleanup);

function renderBar() {
  return render(<TopBar phase="live" reporters={2} lastMessageAt={1000} now={4000} />);
}

describe("TopBar", () => {
  it("puts a Fleet pill before the connection pill", () => {
    renderBar();
    const fleet = screen.getByText("Fleet");
    const connection = screen.getByText(/2 reporters live, synced 3\.0s ago/);
    expect(fleet).toHaveClass("pill");
    expect(fleet.compareDocumentPosition(connection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no clock", () => {
    renderBar();
    expect(screen.queryByLabelText("Local time")).toBeNull();
  });
});
