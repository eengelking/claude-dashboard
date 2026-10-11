import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { FleetApp } from "./fleet/FleetApp";
import { HistoryView } from "./fleet/HistoryView";
import "./theme.css";
import "./components.css";

/** `#/usage` is the earlier usage dashboard; everything else is the Podium fleet console. */
export function isUsageRoute(hash: string): boolean {
  return hash === "#/usage" || hash.startsWith("#/usage/") || hash.startsWith("#/usage?");
}

function Root() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (isUsageRoute(hash)) document.title = "Claude Usage Dashboard";
  }, [hash]);
  if (isUsageRoute(hash)) {
    return (
      <>
        <nav style={{ padding: "8px 16px", fontSize: 13 }}>
          <a href="#/" style={{ color: "var(--text-secondary)" }}>
            ← Podium fleet console
          </a>
        </nav>
        <App />
      </>
    );
  }
  if (hash === "#/history" || hash.startsWith("#/history?")) return <HistoryView />;
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
