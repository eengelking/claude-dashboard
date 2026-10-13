import { useCallback, useEffect, useRef, useState } from "react";
import { AdminError, type AdminApi } from "./adminApi";

/** Loads one server-paged list again whenever `path` changes, and on `reload()`. A 401 reports back so Admin can lock. */
export function useList<T>(api: AdminApi, path: string, onLocked: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lock = useRef(onLocked);
  lock.current = onLocked;
  useEffect(() => {
    let live = true;
    api<T>("GET", path)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof AdminError && e.status === 401) lock.current();
        else setError(e instanceof Error ? e.message : "could not load");
      });
    return () => {
      live = false;
    };
  }, [api, path, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}

/** The message to show for a failed change. */
export function failText(e: unknown): string {
  return e instanceof Error ? e.message : "that did not work";
}
