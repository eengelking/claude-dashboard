import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminView } from "./AdminView";

interface PriceSet {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
}
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
    notices: { "background-sessions": true } as Record<string, boolean>,
    showBackground: false,
    prices: {
      "sonnet-5-5": { std: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 } } as { std: PriceSet; long?: PriceSet },
      "haiku-5-5": { std: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2 }, long: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1 } } as { std: PriceSet; long?: PriceSet },
    } as Record<string, { std: PriceSet; long?: PriceSet }>,
    builtin: { "sonnet-5-5": 2, "haiku-5-5": 0.1 } as Record<string, number>,
    priceError: "" as string,
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
    if (path === "/settings" && method === "PUT") {
      const b = JSON.parse(String(init?.body));
      if (b.notices) for (const [id, on] of Object.entries(b.notices)) state.notices[id] = on as boolean;
      if ("showBackgroundSessions" in b) state.showBackground = b.showBackgroundSessions;
      if (b.modelPrice) {
        if (state.priceError) return json(400, { ok: false, error: state.priceError });
        state.prices[b.modelPrice.key] = { std: b.modelPrice.std, ...(b.modelPrice.long ? { long: b.modelPrice.long } : {}) };
      }
      if (b.resetModelPrice) {
        if (state.builtin[b.resetModelPrice] === 2) state.prices["sonnet-5-5"] = { std: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 } };
        else delete state.prices[b.resetModelPrice];
      }
      return json(200, { ok: true });
    }
    if (path === "/settings") {
      const notices = Object.entries(state.notices).map(([id, on]) => ({ id, name: "Background sessions", description: "Says how many are set aside.", on }));
      const models = Object.entries(state.prices).map(([key, p]) => {
        const builtin = key in state.builtin;
        const base = key === "sonnet-5-5" ? { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 } : undefined;
        return {
          key,
          label: key === "sonnet-5-5" ? "Sonnet 5.5" : key === "haiku-5-5" ? "Haiku 5.5" : key,
          builtin,
          overridden: !!base && p.std.input !== base.input,
          std: p.std,
          ...(p.long ? { long: p.long } : {}),
          ...(base ? { builtinStd: base } : {}),
        };
      });
      return json(200, { allowAdminSecretReporting: true, notices, showBackgroundSessions: state.showBackground, modelPrices: { asOf: "2026-10-13", models } });
    }
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
    // Seven round trips through a 50-row table; the 5 s default was too tight for a shared CI runner.
  }, 15_000);

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
    expect(tabs).toHaveLength(5);
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

describe("Settings tab (#114)", () => {
  it("lists the wall notices and the background-sessions row with switches that follow the server", async () => {
    const srv = fakeServer();
    render(<AdminView />);
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    const notice = await screen.findByRole("switch", { name: /Background sessions/ });
    expect(notice).toHaveAttribute("aria-checked", "true");
    const show = screen.getByRole("switch", { name: /Show background sessions on the wall/ });
    expect(show).toHaveAttribute("aria-checked", "false");
    fireEvent.click(notice);
    await waitFor(() => expect(screen.getByRole("switch", { name: /Background sessions \u00a0?Off|Background sessions Off/ })).toHaveAttribute("aria-checked", "false"));
    expect(srv.notices["background-sessions"]).toBe(false);
    fireEvent.click(show);
    await waitFor(() => expect(srv.showBackground).toBe(true));
  });

  it("opens on the Settings tab for #/admin/settings, the link a closed notice points to", async () => {
    fakeServer();
    window.location.hash = "#/admin/settings";
    render(<AdminView />);
    await unlock();
    expect(screen.getByRole("tab", { name: /^Settings/ })).toHaveAttribute("aria-selected", "true");
    window.location.hash = "";
  });
});

describe("Model prices (#117)", () => {
  async function open() {
    const srv = fakeServer();
    render(<AdminView />);
    await unlock();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    await screen.findByRole("heading", { name: "Model prices" });
    return srv;
  }
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

  it("lists a row per model with its five prices, and a second row for prompts over 100,000 tokens", async () => {
    await open();
    expect(field("Sonnet 5.5 input").value).toBe("2");
    expect(field("Sonnet 5.5 cache write 1 hour").value).toBe("4");
    expect(field("Haiku 5.5 input").value).toBe("0.1");
    expect(field("Haiku 5.5 over 100,000 input").value).toBe("0.5");
    expect(screen.queryByLabelText("Sonnet 5.5 over 100,000 input")).toBeNull();
  });

  it("saves an edited row with all its prices, then marks it changed and offers a reset", async () => {
    const srv = await open();
    expect(screen.queryByRole("button", { name: /Save Sonnet 5.5/ })).toBeNull();
    fireEvent.change(field("Sonnet 5.5 input"), { target: { value: "2.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Sonnet 5.5" }));
    await waitFor(() => expect(srv.prices["sonnet-5-5"]!.std).toEqual({ input: 2.4, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 }));
    expect(await screen.findByRole("button", { name: "Reset Sonnet 5.5 to built-in" })).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });

  it("cancel puts the saved value back without calling the server", async () => {
    const srv = await open();
    fireEvent.change(field("Sonnet 5.5 input"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel Sonnet 5.5" }));
    expect(field("Sonnet 5.5 input").value).toBe("2");
    expect(srv.calls.some((c) => c.startsWith("PUT /settings"))).toBe(false);
  });

  it("resets a changed row to the built-in price", async () => {
    const srv = await open();
    fireEvent.change(field("Sonnet 5.5 input"), { target: { value: "2.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Sonnet 5.5" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset Sonnet 5.5 to built-in" }));
    await waitFor(() => expect(srv.prices["sonnet-5-5"]!.std.input).toBe(2));
    await waitFor(() => expect(field("Sonnet 5.5 input").value).toBe("2"));
    expect(screen.queryByRole("button", { name: "Reset Sonnet 5.5 to built-in" })).toBeNull();
  });

  it.each([
    ["negative", "-1", /zero or more/],
    ["not a number", "abc", /number/],
    ["empty", "", /number/],
    ["over the bound", "5000", /at most 1000/],
  ])("refuses a %s price on the page and sends nothing", async (_n, value, msg) => {
    const srv = await open();
    fireEvent.change(field("Sonnet 5.5 output"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save Sonnet 5.5" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(msg);
    expect(field("Sonnet 5.5 output")).toHaveAttribute("aria-invalid", "true");
    expect(srv.calls.some((c) => c.startsWith("PUT /settings"))).toBe(false);
  });

  it("shows the server's message when it refuses a price", async () => {
    const srv = await open();
    srv.priceError = "output must be at most 1000 USD per million tokens";
    fireEvent.change(field("Sonnet 5.5 output"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Sonnet 5.5" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 1000");
  });

  it("adds a model by id as a row to fill in, saves it, and can remove it", async () => {
    const srv = await open();
    fireEvent.change(screen.getByLabelText("Add a model by its id"), { target: { value: "My-Local-Model" } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    for (const [f, v] of [["input", "0.3"], ["output", "0.9"], ["cache read", "0"], ["cache write 5 minutes", "0"], ["cache write 1 hour", "0"]]) {
      fireEvent.change(field(`my-local-model ${f}`), { target: { value: v } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Save my-local-model" }));
    await waitFor(() => expect(srv.prices["my-local-model"]!.std.input).toBe(0.3));
    fireEvent.click(await screen.findByRole("button", { name: "Remove my-local-model" }));
    await waitFor(() => expect(srv.prices["my-local-model"]).toBeUndefined());
  });

  it("refuses to add a model id that is already in the table", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Add a model by its id"), { target: { value: "sonnet-5-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already/);
  });
});
