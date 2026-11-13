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
  if (path === "" || path === "/plan" || path.startsWith("/plan/")) return (await import("./landing/Landing")).Landing;
  const [{default:Game},{HarborSessionBoundary,HarborAccountPanel}]=await Promise.all([
    import("./expedition/Game"),import("./expedition/harbor-session"),
  ]);
  return function Expedition(){return <HarborSessionBoundary>{session=><Game session={session} accountPanel={<HarborAccountPanel/>}/>}</HarborSessionBoundary>;};
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
