import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import "./styles/theme.css";
import { isNativeApp } from "./lib/native";
import { loadAnalytics } from "./lib/analytics";

// Light/dark is applied by the inline script in index.html — it has to run
// before the blocking stylesheet paints, which is earlier than any module.

// Tell the OTA updater this bundle booted. Deliberately here rather than in
// native-shell.ts: it has to run before anything that could throw, so that a
// bundle broken badly enough to never render still gets rolled back.
if (isNativeApp()) {
  import("./lib/ota").then((m) => m.notifyOtaReady()).catch(() => {});
}

loadAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
