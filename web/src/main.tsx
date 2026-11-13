import "./browser-globals";
import React from "react";
import { createRoot } from "react-dom/client";
async function entry() {
  const path = window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "");
  if (path === "/motion") return (await import("./motion/MotionLab")).MotionLab;
  if (path === "") return (await import("./landing/Landing")).Landing;
  const query = new URLSearchParams(window.location.search);
  const classic = query.get("classic") === "1" || query.get("challenge") === "two-shells-v1";
  if (path === "/expedition" || (path === "/outing" && !classic)) {
    const [{default:Game},{HarborSessionBoundary,HarborAccountPanel}]=await Promise.all([
      import("./expedition/Game"),import("./expedition/harbor-session"),
    ]);
    return function Expedition(){return <HarborSessionBoundary>{session=><Game session={session} accountPanel={<HarborAccountPanel/>}/>}</HarborSessionBoundary>;};
  }
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
