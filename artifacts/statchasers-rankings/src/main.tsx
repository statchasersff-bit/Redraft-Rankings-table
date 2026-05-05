import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Auto-resize support: report document height to parent iframe host
function reportHeight() {
  const height = document.documentElement.scrollHeight;
  window.parent.postMessage({ type: "iframe-resize", height }, "*");
}

if (window.self !== window.top) {
  // Only activate when running inside an iframe
  const observer = new ResizeObserver(reportHeight);
  observer.observe(document.body);
  window.addEventListener("load", reportHeight);
}
