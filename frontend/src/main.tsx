import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FleetApp } from "./fleet/FleetApp";
import { HistoryView } from "./fleet/HistoryView";
import { routeFor } from "./route";

function Root() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (routeFor(hash) === "history") return <HistoryView />;
  return <FleetApp />;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
