import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { registerServiceWorker } from "./lib/service-worker.js";
import "./index.css";

// Register service worker for PWA functionality
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
