import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Auto-resize support: report document height to the parent iframe host.
//
// The tricky case is initial load. The page uses the Inter web font with
// `display=swap`, so the first paint happens in a fallback font, and Inter
// swaps in 100-500ms later — reflowing every row taller. If we only reported
// once early, the parent would lock in the shorter fallback-font height and the
// content would stay clipped by the site footer until something forced another
// report (which is exactly why toggling POS filters "fixed" it). So we report:
//   - whenever the document's size changes (ResizeObserver on documentElement),
//   - once the web fonts have finished loading (the font-swap reflow), and
//   - on window load,
// all coalesced into a single post-paint measurement via requestAnimationFrame
// so rapid bursts collapse to one message with the settled height.
if (window.self !== window.top) {
  let raf = 0;
  const reportHeight = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const height = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: "iframe-resize", height }, "*");
    });
  };

  // documentElement's box tracks total content height (including font-swap and
  // async-content reflows), unlike document.body which didn't reliably fire.
  const observer = new ResizeObserver(reportHeight);
  observer.observe(document.documentElement);

  window.addEventListener("load", reportHeight);
  document.fonts?.ready.then(reportHeight);
}
