import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import "./styles/theme.css";
import { applyMode, getStoredMode } from "./components/uikit/mode";

// Apply the persisted DS v3 light/dark choice before first paint so the new
// shell/chrome renders in the right mode without a flash.
applyMode(getStoredMode());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
