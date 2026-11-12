import React from "react";
import { createRoot } from "react-dom/client";
// Only the legacy harbor needs the testnet signing client.
async function entry() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/motion") return (await import("./motion/MotionLab")).MotionLab;
  if (path === "/outing") return (await import("./outing/Outing")).Outing;
  await import("@fontsource/ibm-plex-mono/latin-400.css");
  await import("./styles.css");
  return (await import("./App")).App;
}
const App = await entry();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
