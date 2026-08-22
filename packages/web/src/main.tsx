import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import "./styles/theme.css";
import { applyMode, getStoredMode } from "./components/uikit/mode";
import { isNativeApp } from "./lib/native";

// Apply the persisted DS v3 light/dark choice before first paint so the new
// shell/chrome renders in the right mode without a flash.
applyMode(getStoredMode());

// Tell the OTA updater this bundle booted. Deliberately here rather than in
// native-shell.ts: it has to run before anything that could throw, so that a
// bundle broken badly enough to never render still gets rolled back.
if (isNativeApp()) {
  import("./lib/ota").then((m) => m.notifyOtaReady()).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
