import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { registerServiceWorker, showAddToHomeScreenPrompt } from "./lib/service-worker.js";
import "./index.css";

// Register service worker for PWA functionality
registerServiceWorker();
showAddToHomeScreenPrompt();

// Remove splash screen when app is ready
const removeSplash = () => {
  const splash = document.getElementById('pwa-splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => {
      splash.remove();
    }, 300);
  }
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App onReady={removeSplash} />
  </React.StrictMode>,
);
