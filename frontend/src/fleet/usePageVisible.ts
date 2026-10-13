import { useEffect, useState } from "react";

const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** False while the tab is hidden, so continuous animation and drawing can stop until it is shown again. */
export function usePageVisible(): boolean {
  const [on, setOn] = useState(visible);
  useEffect(() => {
    const update = () => setOn(visible());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return on;
}
