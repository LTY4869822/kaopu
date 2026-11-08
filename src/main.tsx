import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./AuthGate";
import AppErrorBoundary from "./AppErrorBoundary";
import "@fontsource-variable/noto-sans-sc";
import "./styles.css";
import "./internal-ui.css";
import "./ui-system.css";
// A tab left open across a deployment may still request a removed chunk.
// Reload once, retaining its route and persisted drafts; repeated failures reach
// the visible recovery boundary instead of causing a reload loop.
window.addEventListener("vite:preloadError", event => {
  const key = "shifen:chunk-recovery-at", now = Date.now();
  try {
    const previous = Number(sessionStorage.getItem(key) || 0);
    if (now - previous < 60000) return;
    sessionStorage.setItem(key, String(now));
  } catch { return; }
  event.preventDefault();
  window.location.reload();
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary><AuthGate /></AppErrorBoundary>
  </React.StrictMode>,
);
