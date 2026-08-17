import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";
// Self-hosted type - keeps the app offline and CSP-clean.
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./index.css";
// Component layer after Tailwind so its element rules win over preflight.
import "./styles/ognom-app.css";

// Browser dev without the desktop shell: install the in-memory Tauri shim so
// the whole UI can be exercised. Never part of a production bundle.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  await import("./dev/mockTauri");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      <Toaster
        position="bottom-right"
        offset={{ bottom: 44, right: 16 }}
        toastOptions={{
          style: {
            background: "var(--raised)",
            color: "var(--text)",
            border: "1px solid var(--line-2)",
            borderRadius: "var(--r)",
            font: "450 12.5px/1.5 var(--sans)",
            boxShadow: "var(--shadow)",
          },
        }}
      />
    </ThemeProvider>
  </React.StrictMode>,
);
