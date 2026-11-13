import "./browser-globals";
import React from "react";
import { createRoot } from "react-dom/client";
import type { OpeningStart } from "./opening/Opening";
class BootBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<section className="familiar-boot" role="alert"><p className="boot-brand">familiar.</p><h1>The harbor needs a moment.</h1><p>The game connection could not open. Your saved moves and original requests are unchanged. Check your connection, then reload.</p><a href="">Reload Familiar</a></section>:this.props.children;}
}
async function entry() {
  const path = window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "");
  if (path === "" || path === "/plan" || path.startsWith("/plan/")) return (await import("./landing/Landing")).Landing;
  const game=Promise.all([import("./expedition/Game"),import("./expedition/harbor-session")]);
  // `?play` skips the title screen (browser tests and direct links into play).
  if(new URLSearchParams(window.location.search).has("play")){
    const [{default:Game},{HarborSessionBoundary,HarborAccountPanel}]=await game;
    return function Expedition(){return <HarborSessionBoundary>{session=><Game session={session} accountPanel={<HarborAccountPanel/>}/>}</HarborSessionBoundary>;};
  }
  const [{default:Opening},{HarborAudio}]=await Promise.all([import("./opening/Opening"),import("./expedition/audio")]);
  game.catch(()=>{});
  const hasSave=(()=>{try{return Object.keys(localStorage).some(key=>key.startsWith("familiar.expedition."));}catch{return false;}})();
  return function Outing(){
    const [audio]=React.useState(()=>new HarborAudio());
    const [play,setPlay]=React.useState<{mods:Awaited<typeof game>;start:OpeningStart}|null>(null);
    const [title,setTitle]=React.useState(true);
    // The title's tide holds over the screen until the game code has arrived; a failed download reaches BootBoundary.
    const onStart=(start:OpeningStart)=>game.then(mods=>setPlay({mods,start}),error=>{setPlay(()=>{throw error;});});
    let screen:React.ReactNode=null;
    if(play){
      const [{default:Game},{HarborSessionBoundary,HarborAccountPanel}]=play.mods;
      screen=<HarborSessionBoundary>{session=><Game session={session} accountPanel={<HarborAccountPanel/>} audio={audio} initialSound={play.start.sound} initialMix={[play.start.music,play.start.effects]}/>}</HarborSessionBoundary>;
    }
    return <>
      {screen}
      {title&&<Opening audio={audio} hasSave={hasSave} onStart={onStart} onDone={()=>setTitle(false)}/>}
    </>;
  };
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
