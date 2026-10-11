import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, renderHook } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { CopyResume } from "./components/FactsBar";
import { clampWidth, keyWidth } from "./useResizable";
import { useFleet, type FleetSource } from "./useFleet";
import { useTheme } from "./useTheme";
import { makeSession, makeState } from "./fixtures";
import { stateFrom } from "./testState";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function cols(container: HTMLElement, width = 1440) {
  const el = container.querySelector(".cols") as HTMLElement;
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  el.getBoundingClientRect = () => ({ left: 0, right: width, width, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

describe("resize handles", () => {
  it("are separators with orientation, value and labels", () => {
    render(<FleetView state={stateFrom()} />);
    const rail = screen.getByRole("separator", { name: "Resize orchestrator list" });
    const side = screen.getByRole("separator", { name: "Resize activity panel" });
    for (const h of [rail, side]) {
      expect(h).toHaveAttribute("aria-orientation", "vertical");
      expect(h).toHaveAttribute("tabindex", "0");
    }
    expect(rail).toHaveAttribute("aria-valuenow", "252");
    expect(side).toHaveAttribute("aria-valuenow", "340");
  });

  it("arrow keys move 16 px, Shift 48 px, Home resets, and widths persist", () => {
    const { container } = render(<FleetView state={stateFrom()} />);
    const el = cols(container);
    const rail = screen.getByRole("separator", { name: "Resize orchestrator list" });
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail).toHaveAttribute("aria-valuenow", "268");
    fireEvent.keyDown(rail, { key: "ArrowRight", shiftKey: true });
    expect(rail).toHaveAttribute("aria-valuenow", "316");
    expect(el.style.getPropertyValue("--rail-w")).toBe("316px");
    expect(JSON.parse(localStorage.getItem("podium.panels")!)).toEqual({ rail: 316 });
    const side = screen.getByRole("separator", { name: "Resize activity panel" });
    fireEvent.keyDown(side, { key: "ArrowLeft" });
    expect(side).toHaveAttribute("aria-valuenow", "356");
    fireEvent.keyDown(rail, { key: "Home" });
    expect(rail).toHaveAttribute("aria-valuenow", "252");
    expect(JSON.parse(localStorage.getItem("podium.panels")!)).toEqual({ side: 356 });
  });

  it("drag sets the width within limits; double-click resets", () => {
    // jsdom has no PointerEvent; a MouseEvent subclass carries clientX like the real one.
    class FakePointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", FakePointerEvent);
    const { container } = render(<FleetView state={stateFrom()} />);
    cols(container);
    const rail = screen.getByRole("separator", { name: "Resize orchestrator list" });
    fireEvent.pointerDown(rail, { button: 0, pointerId: 1, clientX: 252 });
    fireEvent.pointerMove(rail, { clientX: 300, pointerId: 1 });
    expect(rail).toHaveAttribute("aria-valuenow", "300");
    expect(localStorage.getItem("podium.panels")).toBeNull();
    fireEvent.pointerMove(rail, { clientX: 20, pointerId: 1 });
    expect(rail).toHaveAttribute("aria-valuenow", "180");
    fireEvent.pointerUp(rail, { clientX: 1000, pointerId: 1 });
    expect(rail).toHaveAttribute("aria-valuenow", "440");
    expect(JSON.parse(localStorage.getItem("podium.panels")!)).toEqual({ rail: 440 });
    fireEvent.doubleClick(rail);
    expect(rail).toHaveAttribute("aria-valuenow", "252");
  });

  it("clamps to the panel limits and keeps the main column at least 420 px", () => {
    expect(clampWidth("rail", 100, 1440, 340)).toBe(180);
    expect(clampWidth("rail", 900, 1440, 340)).toBe(440);
    expect(clampWidth("side", 100, 1440, 252)).toBe(260);
    expect(clampWidth("side", 800, 1440, 252)).toBe(700);
    expect(clampWidth("side", 700, 1200, 252)).toBe(528);
    expect(keyWidth("rail", "ArrowLeft", false, 252)).toBe(236);
    expect(keyWidth("side", "ArrowLeft", true, 340)).toBe(388);
    expect(keyWidth("rail", "Home", false, 300)).toBeUndefined();
    expect(keyWidth("rail", "a", false, 300)).toBeNull();
    // a position the browser could not give (NaN) never becomes a width
    expect(clampWidth("rail", Number.NaN, 1440, 340)).toBe(252);
  });

  it("survives storage that throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<FleetView state={stateFrom()} />);
    const rail = screen.getByRole("separator", { name: "Resize orchestrator list" });
    expect(() => fireEvent.keyDown(rail, { key: "ArrowRight" })).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("copy resume command", () => {
  it("writes the command and shows Copied, then reverts", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<CopyResume command="cd /x && claude --resume s1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy resume command" }));
    });
    expect(writeText).toHaveBeenCalledWith("cd /x && claude --resume s1");
    expect(screen.getByRole("button")).toHaveTextContent("Copied");
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByRole("button")).toHaveTextContent("Copy resume command");
  });

  it("falls back to a selected text field when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CopyResume command="cd /x && claude --resume s1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy resume command" }));
    });
    expect(screen.getByRole("button")).toHaveTextContent("Select and copy");
    const input = screen.getByRole("textbox", { name: "Resume command" }) as HTMLInputElement;
    expect(input.value).toBe("cd /x && claude --resume s1");
  });
});

describe("accessibility", () => {
  it("charts are images with labels; every control is a button, link, input or select", () => {
    const { container } = render(<FleetView state={stateFrom()} />);
    fireEvent.click(container.querySelector(".wall .card")!);
    const imgs = screen.getAllByRole("img").filter((e) => e.tagName.toLowerCase() === "svg");
    expect(imgs).toHaveLength(3);
    for (const i of imgs) expect(i).toHaveAccessibleName(/last 60 seconds/);
    const clickables = [...container.querySelectorAll("[onclick], [role=button]")];
    expect(clickables).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Toggle light and dark theme" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Usage dashboard" })).toHaveAttribute("href", "#/usage");
  });
});

describe("theme", () => {
  it("toggles data-theme and remembers the choice", () => {
    const { result, unmount } = renderHook(() => useTheme());
    expect(result.current.choice).toBeNull();
    act(() => result.current.toggle());
    const first = document.documentElement.dataset.theme;
    expect(first === "light" || first === "dark").toBe(true);
    expect(JSON.parse(localStorage.getItem("podium.theme")!)).toBe(first);
    unmount();
    const again = renderHook(() => useTheme());
    expect(again.result.current.choice).toBe(first);
  });
});

class FakeSource implements FleetSource {
  static last: FakeSource | null = null;
  static opened = 0;
  readyState = 1;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  constructor() {
    FakeSource.last = this;
    FakeSource.opened++;
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

describe("useFleet", () => {
  it("loads state, applies stream messages, flags 6 s of silence and reconnects with a fresh snapshot", async () => {
    vi.useFakeTimers();
    FakeSource.opened = 0;
    const fetchState = vi.fn().mockResolvedValue(makeState());
    const { result } = renderHook(() => useFleet({ open: () => new FakeSource(), fetchState }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("live");
    expect(Object.keys(result.current.sessions)).toEqual(["s1"]);
    act(() => FakeSource.last!.emit("session", makeSession({ id: "s2", name: "two" })));
    expect(Object.keys(result.current.sessions).sort()).toEqual(["s1", "s2"]);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.phase).toBe("live");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.phase).toBe("disconnected");
    const before = FakeSource.opened;
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(FakeSource.opened).toBe(before + 1);
    act(() => FakeSource.last!.emit("snapshot", makeState({ sessions: [makeSession({ id: "s3", name: "three" })] })));
    expect(result.current.phase).toBe("live");
    expect(Object.keys(result.current.sessions)).toEqual(["s3"]);
    expect(result.current.gone.s1).toBe("done");
  });

  it("reopens a stream the browser closed on error", () => {
    vi.useFakeTimers();
    FakeSource.opened = 0;
    renderHook(() => useFleet({ open: () => new FakeSource(), fetchState: () => new Promise(() => {}) }));
    const s = FakeSource.last!;
    s.readyState = 2;
    act(() => s.onerror?.(new Event("error")));
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(FakeSource.opened).toBe(2);
  });
});
