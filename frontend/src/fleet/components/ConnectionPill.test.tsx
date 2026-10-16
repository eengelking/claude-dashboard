import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConnectionPill } from "./ConnectionPill";
import { TopBar } from "./TopBar";

afterEach(cleanup);

describe("ConnectionPill", () => {
  it("says how many reporters are live, singular and plural", () => {
    render(<ConnectionPill phase="live" reporters={1} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^1 reporter live$/);
    cleanup();
    render(<ConnectionPill phase="live" reporters={4} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^4 reporters live$/);
  });

  it("says when it is connecting or disconnected", () => {
    render(<ConnectionPill phase="loading" reporters={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("connecting…");
    cleanup();
    render(<ConnectionPill phase="disconnected" reporters={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("disconnected, retrying");
  });

  it("is the same markup the fleet top bar renders", () => {
    const a = render(<ConnectionPill phase="live" reporters={2} />).container.innerHTML;
    cleanup();
    const b = render(<TopBar page="Fleet" phase="live" reporters={2} />).container.querySelector("[role=status]")?.outerHTML;
    expect(b).toBe(a);
  });
});
