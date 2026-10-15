import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TopBar } from "./TopBar";

afterEach(cleanup);

function renderBar(reporters = 2) {
  return render(<TopBar phase="live" reporters={reporters} />);
}

describe("TopBar", () => {
  it("puts a Fleet pill before the connection pill", () => {
    renderBar();
    const fleet = screen.getByText("Fleet");
    const connection = screen.getByText(/2 reporters live/);
    expect(fleet).toHaveClass("pill");
    expect(fleet.compareDocumentPosition(connection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says how many reporters are live, with no synced time", () => {
    renderBar(3);
    expect(screen.getByRole("status")).toHaveTextContent(/^3 reporters live$/);
    expect(screen.queryByText(/synced/)).toBeNull();
  });

  it("uses the singular for one reporter and the plural for none", () => {
    renderBar(1);
    expect(screen.getByRole("status")).toHaveTextContent(/^1 reporter live$/);
    cleanup();
    renderBar(0);
    expect(screen.getByRole("status")).toHaveTextContent(/^0 reporters live$/);
  });

  it("has no clock", () => {
    renderBar();
    expect(screen.queryByLabelText("Local time")).toBeNull();
  });
});
