import React from "react";
import { createRoot } from "react-dom/client";
// The motion study must never initialize the game's signing client.
const { App } = /^\/motion\/?$/.test(window.location.pathname)
  ? { App: (await import("./motion/MotionLab")).MotionLab }
  : await import("./App");
if (!/^\/motion\/?$/.test(window.location.pathname)) {
  await import("@fontsource/ibm-plex-mono/latin-400.css");
  await import("./styles.css");
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
