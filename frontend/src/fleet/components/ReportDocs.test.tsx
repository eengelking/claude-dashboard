import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReportDocs } from "./ReportDocs";
import { makeAgent, makeSession } from "../fixtures";
import type { AgentView } from "../types";

afterEach(() => {
  cleanup();
  document.body.classList.remove("modal-open");
});

function show(over: Partial<AgentView>, texts: { prompt: string | null; answer: string | null } | Error = { prompt: "# Task\n\nDo **it**.", answer: "## Done" }, sessionOver = {}) {
  const a = makeAgent({ id: "t", ...over });
  const s = makeSession({ agents: [a], ...sessionOver });
  const fetchText = vi.fn(async () => {
    if (texts instanceof Error) throw texts;
    return texts;
  });
  const r = render(<ReportDocs s={s} a={a} fetchText={fetchText} />);
  return { ...r, fetchText };
}

describe("Report buttons", () => {
  it("are enabled with the length when the server holds the full text", () => {
    show({ promptChars: 1842, answerChars: 2604, status: "done", answerExcerpt: "x" });
    const p = screen.getByRole("button", { name: /Task prompt/ });
    const a = screen.getByRole("button", { name: /Final answer/ });
    expect(p).toBeEnabled();
    expect(p).toHaveTextContent("1,842 chars");
    expect(a).toBeEnabled();
    expect(a).toHaveTextContent("2,604 chars");
    expect(p).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("are dimmed and inert, saying why, when there is no text", () => {
    show({ promptExcerpt: "", answerExcerpt: null, status: "running" });
    const p = screen.getByRole("button", { name: /Task prompt/ });
    const a = screen.getByRole("button", { name: /Final answer/ });
    expect(p).toBeDisabled();
    expect(p).toHaveTextContent("not reported");
    expect(a).toBeDisabled();
    expect(a).toHaveTextContent("not finished");
    fireEvent.click(a);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("say not reported, not not finished, for a finished agent with no answer", () => {
    show({ status: "failed", answerExcerpt: null });
    expect(screen.getByRole("button", { name: /Final answer/ })).toHaveTextContent("not reported");
  });

  it("stay enabled on the 400-character excerpt when there is no full text", () => {
    show({ promptExcerpt: "Find every call site.", promptChars: null });
    const p = screen.getByRole("button", { name: /Task prompt/ });
    expect(p).toBeEnabled();
    expect(p).toHaveTextContent("excerpt only");
  });

  it("the Final answer button turns on when the answer arrives, without a reload", () => {
    const a = makeAgent({ id: "t", status: "running", answerExcerpt: null });
    const s = makeSession({ agents: [a] });
    const r = render(<ReportDocs s={s} a={a} fetchText={async () => ({ prompt: null, answer: "x" })} />);
    expect(screen.getByRole("button", { name: /Final answer/ })).toBeDisabled();
    const done = { ...a, status: "done" as const, answerExcerpt: "ok", answerChars: 2 };
    r.rerender(<ReportDocs s={{ ...s, agents: [done] }} a={done} fetchText={async () => ({ prompt: null, answer: "x" })} />);
    expect(screen.getByRole("button", { name: /Final answer/ })).toBeEnabled();
  });
});

describe("Report modal", () => {
  it("opens as a labelled modal dialog with the text rendered as markdown", async () => {
    const { fetchText } = show({ promptChars: 20 });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    const d = screen.getByRole("dialog");
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(d).toHaveAccessibleName("Task prompt");
    await waitFor(() => expect(d.querySelector("h1")?.textContent).toBe("Task"));
    expect(d.querySelector("strong")!.textContent).toBe("it");
    expect(fetchText).toHaveBeenCalledWith("s1", "t");
    expect(document.body.classList.contains("modal-open")).toBe(true);
  });

  it("shows the answer from the same fetch", async () => {
    show({ promptChars: 20, answerChars: 7, status: "done", answerExcerpt: "Done" });
    fireEvent.click(screen.getByRole("button", { name: /Final answer/ }));
    const d = screen.getByRole("dialog");
    await waitFor(() => expect(d.querySelector(".mb h2")?.textContent).toBe("Done"));
  });

  it("moves focus in, and returns it to the button on Esc", async () => {
    show({ promptChars: 20 });
    const btn = screen.getByRole("button", { name: /Task prompt/ });
    btn.focus();
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Close (Esc)" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
    expect(document.body.classList.contains("modal-open")).toBe(false);
  });

  it("closes with the X and with a click on the dimmed area, not on the dialog itself", () => {
    show({ promptChars: 20 });
    const open = () => fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    open();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close (Esc)" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab inside the dialog", () => {
    show({ promptChars: 20 });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    const copy = screen.getByRole("button", { name: "Copy" });
    const body = screen.getByRole("dialog").querySelector<HTMLElement>(".mb")!;
    body.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(copy).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(body).toHaveFocus();
  });

  it("does not let Esc or the shell shortcuts reach the page behind it", () => {
    show({ promptChars: 20 });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener("keydown", spy);
    fireEvent.keyDown(document, { key: "w" });
    fireEvent.keyDown(document, { key: "Escape" });
    document.removeEventListener("keydown", spy);
    expect(seen).toEqual([]);
  });

  it("copies the raw text", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    show({ promptChars: 20 });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    await waitFor(() => expect(screen.getByRole("dialog").querySelector("h1")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("# Task\n\nDo **it**.");
  });

  it("falls back to the excerpt with a note when the full text is not there", () => {
    const { fetchText } = show({ promptExcerpt: "Find every call site.", promptChars: null });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    const d = screen.getByRole("dialog");
    expect(d).toHaveTextContent("Find every call site.");
    expect(d).toHaveTextContent("first 400 characters");
    expect(fetchText).not.toHaveBeenCalled();
  });

  it("tells a reporter older than 0.10 to update, and a newer one about the option", () => {
    show({ promptExcerpt: "x" }, undefined, { reporterVersion: "0.9.0" });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("podium-reporter 0.10.0");
    cleanup();
    show({ promptExcerpt: "x" }, undefined, { reporterVersion: "0.10.0" });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("fullPrompts");
  });

  it("falls back to the excerpt, and says so, when the fetch fails", async () => {
    show({ promptChars: 20, promptExcerpt: "Find every call site." }, new Error("HTTP 500"));
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    const d = screen.getByRole("dialog");
    await waitFor(() => expect(d).toHaveTextContent("Could not load the full text"));
    expect(d).toHaveTextContent("Find every call site.");
  });

  it("shows a script tag in the text as text", async () => {
    show({ promptChars: 40 }, { prompt: "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>", answer: null });
    fireEvent.click(screen.getByRole("button", { name: /Task prompt/ }));
    const d = screen.getByRole("dialog");
    await waitFor(() => expect(d).toHaveTextContent("<script>alert(1)</script>"));
    expect(d.querySelector("script")).toBeNull();
    expect(d.querySelector("img")).toBeNull();
  });
});
