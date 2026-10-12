// Which of the left pane, right pane and top bar are collapsed, and wall mode. The flags are kept in
// localStorage apart from the saved widths (useResizable), so expanding a pane returns it to its width.
// Wall mode collapses all three without touching the saved flags, so leaving it restores them, and a
// reload comes back out of it.
import { useCallback, useState } from "react";
import { readJson, writeJson } from "./storage";

export type Pane = "left" | "right" | "top";
export type Collapsed = Record<Pane, boolean>;
const KEY = "podium.collapsed";
const ALL: Collapsed = { left: true, right: true, top: true };

function load(): Collapsed {
  const v = readJson<Partial<Record<Pane, unknown>> | null>(KEY, null);
  return { left: v?.left === true, right: v?.right === true, top: v?.top === true };
}

export interface Panes {
  /** What is collapsed right now: wall mode collapses everything. */
  collapsed: Collapsed;
  wall: boolean;
  toggle: (pane: Pane) => void;
  enterWall: () => void;
  exitWall: () => void;
}

export function usePanes(): Panes {
  const [saved, setSaved] = useState<Collapsed>(load);
  const [wall, setWall] = useState(false);

  const save = useCallback((next: Collapsed) => {
    setSaved(next);
    writeJson(KEY, next);
  }, []);

  const toggle = useCallback(
    (pane: Pane) => {
      if (wall) {
        // Opening a pane from its edge tab ends wall mode and restores the saved flags, with that pane open.
        setWall(false);
        save({ ...saved, [pane]: false });
        return;
      }
      save({ ...saved, [pane]: !saved[pane] });
    },
    [wall, saved, save],
  );

  const enterWall = useCallback(() => setWall(true), []);
  const exitWall = useCallback(() => setWall(false), []);

  return { collapsed: wall ? ALL : saved, wall, toggle, enterWall, exitWall };
}
