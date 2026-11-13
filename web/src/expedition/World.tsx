import { useEffect, useRef, useState } from "react";
import type { Command, CourtEvent, CourtTransition, Position } from "./types";
import type { ExpeditionScene, HomePlace, WorldSnapshot } from "./scene";

export interface ExpeditionWorldProps {
  snapshot:WorldSnapshot;
  transition:CourtTransition|null;
  presentationId:number;
  paused:boolean;
  onCommand:(command:Command)=>void;
  onInspect:(position:Position)=>void;
  onTarget:(position:Position)=>void;
  onHover:(position:Position|null)=>void;
  onHome:(place:HomePlace)=>void;
  onSettled:(id:number)=>void;
  onBeat:(event:CourtEvent,index:number)=>void;
  onFault:(message:string)=>void;
  onReady:()=>void;
}

export default function World(props:ExpeditionWorldProps){
  const mount=useRef<HTMLDivElement>(null),scene=useRef<ExpeditionScene|null>(null),current=useRef(props);
  const [ready,setReady]=useState(false),[tiles,setTiles]=useState<unknown[]>([]);
  current.current=props;
  useEffect(()=>{
    let alive=true,game:import("phaser").Game|undefined;
    const lost=(event:Event)=>{event.preventDefault();if(alive)current.current.onFault("The drawing surface stopped. Your accepted moves are saved. Reload the scene to continue.");};
    void Promise.all([import("phaser"),import("./scene")]).then(([{default:Phaser},{ExpeditionScene}])=>{
      if(!alive||!mount.current)return;
      const next=new ExpeditionScene(current.current.snapshot,{
        command:command=>current.current.onCommand(command),target:position=>current.current.onTarget(position),inspect:position=>current.current.onInspect(position),hover:position=>current.current.onHover(position),home:place=>current.current.onHome(place),
        ready:()=>{if(!alive)return;setReady(true);current.current.onReady();next.setGated(current.current.paused);},fault:message=>{if(alive)current.current.onFault(message);},
        beat:(event,index)=>{if(alive)current.current.onBeat(event,index);},settled:id=>{if(alive)current.current.onSettled(id);},geometry:geometry=>{if(alive)setTiles([...geometry]);},
      });scene.current=next;
      game=new Phaser.Game({type:Phaser.AUTO,parent:mount.current,width:mount.current.clientWidth,height:mount.current.clientHeight,transparent:true,antialias:true,banner:false,audio:{noAudio:true},loader:{imageLoadType:"HTMLImageElement"},scene:next,scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},input:{keyboard:false}});
      game.canvas.setAttribute("aria-hidden","true");game.canvas.addEventListener("webglcontextlost",lost);
    }).catch(()=>{if(alive)current.current.onFault("The playfield could not open. Your saved harbor is safe. Retry the scene.");});
    return()=>{alive=false;scene.current=null;if(game){game.canvas.removeEventListener("webglcontextlost",lost);game.destroy(true);}};
  },[]);
  useEffect(()=>{if(ready)scene.current?.setSnapshot(props.snapshot,props.transition,props.presentationId);},[ready,props.snapshot,props.transition,props.presentationId]);
  useEffect(()=>{scene.current?.setGated(props.paused);},[props.paused]);
  const {passage,court,home}=props.snapshot;
  let description=court?"Spatial tide court. Equivalent movement and interaction controls follow.":"Mochi and Bram at Pocket Harbor. Choose a place using the harbor controls.";
  if(passage&&court){
    const delivered=passage.stage==="delivered",bell=passage.job==="bell";
    const location=bell?(delivered?"far left work steps":"near left Bell Steps"):(delivered?"near right quay":"far right Reed Steps");
    description=`${bell?"Bram’s supplies":"The empty skiff"} at the ${location}. ${passage.watched?"Mochi and you watched the reeds. ":""}Movement and service controls follow.`;
    if(passage.heardBell)description+=" Mochi heard the old bell in the far-left hollow.";
    if(passage.bellRigged)description+=` Bell pull at far center, ${passage.pullSpent?"used":"one pull available"}.`;
  }else if(!court&&home.services?.length){
    if(home.services.includes("bell"))description+=" Bram’s supplies have reached the Bell work steps.";
    if(home.services.includes("reed"))description+=" The Reed skiff is moored on the harbor side.";
  }
  if(!court&&home.heardBell)description+=" Bram has rigged the shore bell pull for future crossings.";
  return <div ref={mount} className="exp-world" data-testid="expedition-world" data-ready={ready} data-tiles={JSON.stringify(tiles)} data-position={court?`${court.position.x},${court.position.y}`:"home"} data-turn={court?.turn??0} data-passage={passage?.job} data-service-stage={passage?.stage} data-home-services={home.services?.join(" ")} data-preview-exit={props.snapshot.previewWave?.exit} data-lantern-motif={!court&&home.lantern?home.motif:undefined} data-lantern-finish={!court&&home.lantern?home.polished?"harbor_polish":"original":undefined} role="img" aria-label={description}/>;
}
