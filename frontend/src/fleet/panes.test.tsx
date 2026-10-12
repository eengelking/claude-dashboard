import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, renderHook, render, screen, act } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { stateFrom } from "./testState";
import { usePanes } from "./usePanes";
import { useHotkeys } from "./useHotkeys";
import { useIdle } from "./useIdle";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePanes", () => {
  it("starts with everything open and toggles each pane independently", () => {
    const { result } = renderHook(() => usePanes());
    expect(result.current.collapsed).toEqual({ left: false, right: false, top: false });
    act(() => result.current.toggle("left"));
    expect(result.current.collapsed).toEqual({ left: true, right: false, top: false });
    act(() => result.current.toggle("top"));
    act(() => result.current.toggle("left"));
    expect(result.current.collapsed).toEqual({ left: false, right: false, top: true });
  });

  it("remembers the collapsed flags under podium.collapsed, apart from podium.panels", () => {
    localStorage.setItem("podium.panels", JSON.stringify({ rail: 300 }));
    const first = renderHook(() => usePanes());
    act(() => first.result.current.toggle("right"));
    expect(JSON.parse(localStorage.getItem("podium.collapsed")!)).toEqual({ left: false, right: true, top: false });
    expect(JSON.parse(localStorage.getItem("podium.panels")!)).toEqual({ rail: 300 });
    first.unmount();
    const second = renderHook(() => usePanes());
    expect(second.result.current.collapsed.right).toBe(true);
  });

  it("ignores junk in storage and survives a storage that throws", () => {
    localStorage.setItem("podium.collapsed", JSON.stringify({ left: "yes", right: 1 }));
    expect(renderHook(() => usePanes()).result.current.collapsed).toEqual({ left: false, right: false, top: false });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => usePanes());
    act(() => result.current.toggle("left"));
    expect(result.current.collapsed.left).toBe(true);
  });

  it("wall mode collapses all three and leaving restores what was open before", () => {
    const { result } = renderHook(() => usePanes());
    act(() => result.current.toggle("right"));
    act(() => result.current.enterWall());
    expect(result.current.wall).toBe(true);
    expect(result.current.collapsed).toEqual({ left: true, right: true, top: true });
    act(() => result.current.exitWall());
    expect(result.current.wall).toBe(false);
    expect(result.current.collapsed).toEqual({ left: false, right: true, top: false });
  });

  it("does not remember wall mode: a reload comes back out of it, with the earlier flags", () => {
    const first = renderHook(() => usePanes());
    act(() => first.result.current.toggle("left"));
    act(() => first.result.current.enterWall());
    expect(JSON.parse(localStorage.getItem("podium.collapsed")!)).toEqual({ left: true, right: false, top: false });
    first.unmount();
    const second = renderHook(() => usePanes());
    expect(second.result.current.wall).toBe(false);
    expect(second.result.current.collapsed).toEqual({ left: true, right: false, top: false });
  });

  it("expanding a pane during wall mode leaves wall mode, restores the saved flags and opens that pane", () => {
    const { result } = renderHook(() => usePanes());
    act(() => result.current.toggle("right"));
    act(() => result.current.toggle("top"));
    act(() => result.current.enterWall());
    act(() => result.current.toggle("top"));
    expect(result.current.wall).toBe(false);
    expect(result.current.collapsed).toEqual({ left: false, right: true, top: false });
    expect(JSON.parse(localStorage.getItem("podium.collapsed")!)).toEqual({ left: false, right: true, top: false });
  });
});

describe("useHotkeys", () => {
  it("calls the handler for a bound key and ignores others", () => {
    const onKey = vi.fn();
    renderHook(() => useHotkeys(onKey));
    fireEvent.keyDown(document, { key: "[" });
    fireEvent.keyDown(document, { key: "x" });
    expect(onKey.mock.calls.map((c) => c[0].key)).toEqual(["[", "x"]);
  });

  it("ignores keys typed into fields, with modifiers, or on a resize separator", () => {
    const onKey = vi.fn();
    renderHook(() => useHotkeys(onKey));
    const input = document.createElement("input");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const sep = document.createElement("div");
    sep.setAttribute("role", "separator");
    document.body.append(input, select, editable, sep);
    for (const el of [input, select, editable, sep]) fireEvent.keyDown(el, { key: "[" });
    fireEvent.keyDown(document, { key: "[", ctrlKey: true });
    fireEvent.keyDown(document, { key: "[", metaKey: true });
    fireEvent.keyDown(document, { key: "[", altKey: true });
    expect(onKey).not.toHaveBeenCalled();
    document.body.replaceChildren();
  });

  it("stops listening on unmount", () => {
    const onKey = vi.fn();
    renderHook(() => useHotkeys(onKey)).unmount();
    fireEvent.keyDown(document, { key: "[" });
    expect(onKey).not.toHaveBeenCalled();
  });
});

describe("useIdle", () => {
  it("is idle after the delay without activity, and wakes on pointer, touch or key", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdle(true, 4000));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(3999));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    act(() => void fireEvent.pointerMove(document));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(4000));
    expect(result.current).toBe(true);
    act(() => void fireEvent.touchStart(document));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(4000));
    act(() => void fireEvent.keyDown(document, { key: "a" }));
    expect(result.current).toBe(false);
  });

  it("never goes idle while disabled, and clears when disabled again", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ on }) => useIdle(on, 1000), { initialProps: { on: false } });
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
    rerender({ on: true });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });

  it("stays awake while the pointer is over a control", () => {
    vi.useFakeTimers();
    const btn = document.createElement("button");
    btn.setAttribute("data-wall-control", "");
    document.body.append(btn);
    const { result } = renderHook(() => useIdle(true, 1000));
    fireEvent.pointerMove(btn);
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
    fireEvent.pointerMove(document);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
    btn.remove();
  });
});

describe("FleetView collapsible shell", () => {
  const lost = () => ({ ...stateFrom(), phase: "disconnected" as const });
  const left = () => screen.getByRole("button", { name: /left pane/i });
  const right = () => screen.getByRole("button", { name: /right pane/i });

  it("collapses and expands the left pane from its tab and from [", () => {
    const { container } = render(<FleetView state={stateFrom()} />);
    expect(left()).toHaveAttribute("aria-expanded", "true");
    expect(left()).toHaveAttribute("aria-controls", "podium-rail-body");
    fireEvent.click(left());
    expect(left()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("podium-rail-body")).not.toBeVisible();
    expect((container.querySelector(".cols") as HTMLElement).style.getPropertyValue("--rail-w")).toBe("24px");
    fireEvent.keyDown(document, { key: "[" });
    expect(left()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("podium-rail-body")).toBeVisible();
  });

  it("collapses the right pane with ] and gives its width to the main column", () => {
    const { container } = render(<FleetView state={stateFrom()} />);
    fireEvent.keyDown(document, { key: "]" });
    expect(right()).toHaveAttribute("aria-expanded", "false");
    expect((container.querySelector(".cols") as HTMLElement).style.getPropertyValue("--side-w")).toBe("24px");
    expect(screen.queryByRole("separator", { name: "Resize activity panel" })).toBeNull();
  });

  it("expanding returns a pane to its saved width", () => {
    localStorage.setItem("podium.panels", JSON.stringify({ rail: 300 }));
    const { container } = render(<FleetView state={stateFrom()} />);
    fireEvent.click(left());
    fireEvent.click(left());
    expect((container.querySelector(".cols") as HTMLElement).style.getPropertyValue("--rail-w")).toBe("300px");
  });

  it("hides the top bar and its banner with \\, and brings them back", () => {
    render(<FleetView state={stateFrom()} />);
    expect(screen.getByText(/Live fleet\./)).toBeVisible();
    fireEvent.keyDown(document, { key: "\\" });
    expect(document.getElementById("podium-top")).not.toBeVisible();
    expect(screen.queryByText(/Live fleet\./)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show top bar" }));
    expect(document.getElementById("podium-top")).toBeVisible();
    expect(screen.getByText(/Live fleet\./)).toBeVisible();
  });

  it("keeps the disconnect alert with everything collapsed, and clears it on reconnect", () => {
    const { rerender } = render(<FleetView state={lost()} />);
    fireEvent.keyDown(document, { key: "w" });
    expect(screen.getByRole("alert")).toHaveTextContent("Lost the connection to the Podium server.");
    rerender(<FleetView state={stateFrom()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores the shortcuts while typing in a field", () => {
    const { container } = render(<FleetView state={stateFrom()} />);
    const box = container.querySelector("input") as HTMLElement;
    fireEvent.keyDown(box, { key: "[" });
    expect(left()).toHaveAttribute("aria-expanded", "true");
  });

  it("wall mode: one click collapses all three; Esc and the exit button both leave and restore", () => {
    render(<FleetView state={stateFrom()} />);
    fireEvent.keyDown(document, { key: "]" });
    fireEvent.click(screen.getByRole("button", { name: "Enter wall mode" }));
    expect(left()).toHaveAttribute("aria-expanded", "false");
    expect(right()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("podium-top")).not.toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(left()).toHaveAttribute("aria-expanded", "true");
    expect(right()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("podium-top")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enter wall mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit wall mode" }));
    expect(left()).toHaveAttribute("aria-expanded", "true");
    expect(right()).toHaveAttribute("aria-expanded", "false");
  });

  const fullscreenApi = (request: () => Promise<void>) => {
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: request });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
    return exit;
  };
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("wall mode asks for fullscreen from the click only, and leaves it on exit", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const exit = fullscreenApi(request);
    render(<FleetView state={stateFrom()} />);
    fireEvent.keyDown(document, { key: "w" });
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Enter wall mode" }));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });
    expect(exit).toHaveBeenCalled();
  });

  it("wall mode still works when the browser refuses fullscreen", async () => {
    const exit = fullscreenApi(vi.fn().mockRejectedValue(new Error("refused")));
    render(<FleetView state={stateFrom()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter wall mode" }));
    await act(async () => {});
    expect(left()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Exit wall mode" }));
    expect(left()).toHaveAttribute("aria-expanded", "true");
    expect(exit).not.toHaveBeenCalled();
  });

  it("leaving fullscreen with the browser's own Esc also leaves wall mode", async () => {
    fullscreenApi(vi.fn().mockResolvedValue(undefined));
    render(<FleetView state={stateFrom()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter wall mode" }));
    await act(async () => {});
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    fireEvent(document, new Event("fullscreenchange"));
    expect(left()).toHaveAttribute("aria-expanded", "true");
  });

  it("wall mode hides the cursor and its buttons when idle, and shows them again on movement", () => {
    vi.useFakeTimers();
    const { container } = render(<FleetView state={stateFrom()} />);
    const podium = container.querySelector(".podium") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Enter wall mode" }));
    expect(podium).not.toHaveClass("idle");
    act(() => void vi.advanceTimersByTime(4000));
    expect(podium).toHaveClass("idle");
    act(() => void fireEvent.pointerMove(document));
    expect(podium).not.toHaveClass("idle");
  });

  it("remembers collapsed panes across a reload", () => {
    const first = render(<FleetView state={stateFrom()} />);
    fireEvent.keyDown(document, { key: "[" });
    fireEvent.keyDown(document, { key: "\\" });
    first.unmount();
    render(<FleetView state={stateFrom()} />);
    expect(left()).toHaveAttribute("aria-expanded", "false");
    expect(right()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("podium-top")).not.toBeVisible();
  });
});
