import "./browser-globals";
import React from "react";
import { createRoot } from "react-dom/client";
class BootBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<section className="familiar-boot" role="alert"><p className="boot-brand">familiar.</p><h1>The harbor needs a moment.</h1><p>The game connection could not open. Your saved moves and original requests are unchanged. Check your connection, then reload.</p><a href="">Reload Familiar</a></section>:this.props.children;}
}
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
try {
const App = await entry();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BootBoundary><App /></BootBoundary>
  </React.StrictMode>,
);

} catch (error) {
  const status = document.querySelector("[data-boot-status]");
  if (status) status.textContent = "The game could not download. Check your connection, then reload. Your saved harbor has not changed.";
  console.error("Familiar could not open", error);
}
