import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminView } from "./AdminView";

interface P {
  id: number;
  name: string;
  groupId: number | null;
  revokedAt: number | null;
}

/** A small in-memory stand-in for /api/admin. */
function fakeServer(opts: { people?: number; enabled?: boolean; unlocked?: boolean } = {}) {
  const state = {
    enabled: opts.enabled ?? true,
    unlocked: opts.unlocked ?? false,
    people: Array.from({ length: opts.people ?? 0 }, (_, i): P => ({ id: i + 1, name: `person-${String(i).padStart(3, "0")}`, groupId: null, revokedAt: null })),
    groups: [] as { id: number; name: string }[],
    calls: [] as string[],
    expire: false,
  };
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  const row = (p: P) => ({ id: p.id, name: p.name, last4: "ab12", groupId: p.groupId, groupName: state.groups.find((g) => g.id === p.groupId)?.name ?? null, createdAt: 1, rotatedAt: null, revokedAt: p.revokedAt, lastReportAt: null, machines: [] });
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/api/admin", "");
    state.calls.push(`${method} ${path}${url.search}`);
    if (path === "/session") return json(200, { enabled: state.enabled, unlocked: state.unlocked });
    if (path === "/unlock") {
      const secret = JSON.parse(String(init?.body)).secret;
      if (secret === "right") {
        state.unlocked = true;
        return json(200, { ok: true });
      }
      return json(401, { ok: false, error: "wrong secret" });
    }
    if (state.expire || !state.unlocked) return json(401, { ok: false, error: "locked" });
    if (path === "/lock") {
      state.unlocked = false;
      return json(200, { ok: true });
    }
    if (path === "/people" && method === "GET") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("pageSize") ?? 50);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const all = state.people.filter((p) => p.name.toLowerCase().includes(q));
      return json(200, { total: all.length, page, pageSize: size, rows: all.slice((page - 1) * size, page * size).map(row), groups: state.groups });
    }
    if (path === "/people" && method === "POST") {
      const name = JSON.parse(String(init?.body)).name as string;
      const p = { id: state.people.length + 1, name, groupId: null, revokedAt: null };
      state.people.push(p);
      return json(201, { ok: true, person: row(p), token: "pdm_aaaaaaaaaaaa_" + "b".repeat(48) });
    }
    if (path === "/groups") return json(200, { total: 0, page: 1, pageSize: 50, rows: [] });
    if (path === "/log") return json(200, { total: 1, page: 1, pageSize: 50, rows: [{ id: 1, t: 1, kind: "unlock_failed", detail: "Wrong secret (1)", source: "10.0.0.1" }] });
    if (path === "/settings") return json(200, { allowAdminSecretReporting: true });
    return json(404, { ok: false, error: "nope" });
  });
  vi.stubGlobal("fetch", fetchFn);
  return state;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function unlock() {
  fireEvent.change(await screen.findByLabelText("Admin secret"), { target: { value: "right" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock Admin" }));
  await screen.findByRole("tablist", { name: "Admin sections" });
}

describe("Admin lock screen", () => {
  it("asks for the secret, rejects a wrong one, and opens with the right one", async () => {
    fakeServer();
    render(<AdminView />);
    fireEvent.change(await screen.findByLabelText("Admin secret"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Admin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not the admin secret.");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect((screen.getByLabelText("Admin secret") as HTMLInputElement).value).toBe("");
    await unlock();
    expect(screen.getByRole("tab", { name: /People/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens straight away when this browser already has a session", async () => {
    fakeServer({ unlocked: true });
    render(<AdminView />);
    expect(await screen.findByRole("tablist", { name: "Admin sections" })).toBeInTheDocument();
  });

  it("says Admin is off when the server has no token", async () => {
    fakeServer({ enabled: false });
    render(<AdminView />);
    expect(await screen.findByText("Admin is off")).toBeInTheDocument();
    expect(screen.queryByLabelText("Admin secret")).toBeNull();
  });
});

describe("tokens", () => {
  it("shows a new token once, keeps it across tabs, and drops it when saved or locked out", async () => {
    fakeServer();
    render(<AdminView />);
    await unlock();
    fireEvent.change(await screen.findByLabelText("Add a person"), { target: { value: "Dana" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const code = await screen.findByText(/token: pdm_aaaaaaaaaaaa_/);
    expect(code).toHaveTextContent("userName: Dana");
    fireEvent.click(screen.getByRole("tab", { name: /Admin log/ }));
    expect(screen.getByText(/token: pdm_aaaaaaaaaaaa_/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByText(/pdm_aaaaaaaaaaaa_/)).toBeNull();
    // After it, the list shows only the last four characters.
    fireEvent.click(screen.getByRole("tab", { name: /People/ }));
    expect(await screen.findByText("pdm_…ab12")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("pdm_aaaaaaaaaaaa_");
  });

  it("never writes a token or the secret to browser storage", async () => {
    fakeServer();
    render(<AdminView />);
    await unlock();
    fireEvent.change(await screen.findByLabelText("Add a person"), { target: { value: "Dana" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await screen.findByText(/token: pdm_/);
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain("pdm_");
    expect(stored).not.toContain("right");
  });

  it("goes back to the lock screen, and forgets the token, when the server says it is locked", async () => {
    const s = fakeServer();
    render(<AdminView />);
    await unlock();
    fireEvent.change(await screen.findByLabelText("Add a person"), { target: { value: "Dana" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await screen.findByText(/token: pdm_/);
    s.expire = true;
    fireEvent.click(screen.getByRole("tab", { name: /Admin log/ }));
    expect(await screen.findByLabelText("Admin secret")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/locked after 10 minutes/);
    expect(document.body.textContent).not.toContain("pdm_aaaaaaaaaaaa_");
  });
});

describe("paging and search", () => {
  it("asks the server for 50 at a time, pages forward and back, and searches", async () => {
    const s = fakeServer({ people: 125 });
    render(<AdminView />);
    await unlock();
    expect(await screen.findByText("Showing 1 to 50 of 125")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Showing 51 to 100 of 125")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Showing 101 to 125 of 125")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Showing 51 to 100 of 125")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find a person"), { target: { value: "person-099" } });
    expect(await screen.findByText("Showing 1 to 1 of 1")).toBeInTheDocument();
    expect(s.calls.some((c) => c.includes("q=person-099") && c.includes("page=1"))).toBe(true);
    fireEvent.change(screen.getByLabelText("Find a person"), { target: { value: "zzz" } });
    expect(await screen.findByText(/No one matches/)).toBeInTheDocument();
  });

  it("changes the rows per page and returns to page one", async () => {
    const s = fakeServer({ people: 125 });
    render(<AdminView />);
    await unlock();
    await screen.findByText("Showing 1 to 50 of 125");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Showing 51 to 100 of 125");
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "25" } });
    expect(await screen.findByText("Showing 1 to 25 of 125")).toBeInTheDocument();
    expect(s.calls[s.calls.length - 1]).toContain("pageSize=25");
  });
});

describe("tabs", () => {
  it("move with the arrow keys, Home and End", async () => {
    fakeServer();
    render(<AdminView />);
    await unlock();
    const tabs = within(screen.getByRole("tablist", { name: "Admin sections" })).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Groups/ })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Groups/ }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: /Admin log/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /People/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /Admin log/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByText("Wrong secret (1)")).toBeInTheDocument());
  });
});
