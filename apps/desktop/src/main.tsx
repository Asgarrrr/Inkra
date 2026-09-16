import "./wdyr";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { mark } from "./lib/startup-metrics";

// Imports above are hoisted, so by the time this runs the whole entry chunk has
// been parsed and its top-level code evaluated. The gap from `document-ready`
// (marked inline in index.html) to here is that cost.
mark("script-eval");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
