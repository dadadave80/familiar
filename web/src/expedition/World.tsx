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
      game=new Phaser.Game({type:Phaser.AUTO,parent:mount.current,width:mount.current.clientWidth,height:mount.current.clientHeight,transparent:true,antialias:true,banner:false,audio:{noAudio:true},scene:next,scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},input:{keyboard:false}});
      game.canvas.setAttribute("aria-hidden","true");game.canvas.addEventListener("webglcontextlost",lost);
    }).catch(()=>{if(alive)current.current.onFault("The playfield could not open. Your saved harbor is safe. Retry the scene.");});
    return()=>{alive=false;scene.current=null;if(game){game.canvas.removeEventListener("webglcontextlost",lost);game.destroy(true);}};
  },[]);
  useEffect(()=>{if(ready)scene.current?.setSnapshot(props.snapshot,props.transition,props.presentationId);},[ready,props.snapshot,props.transition,props.presentationId]);
  useEffect(()=>{scene.current?.setGated(props.paused);},[props.paused]);
  return <div ref={mount} className="exp-world" data-testid="expedition-world" data-ready={ready} data-tiles={JSON.stringify(tiles)} data-position={props.snapshot.court?`${props.snapshot.court.position.x},${props.snapshot.court.position.y}`:"home"} data-turn={props.snapshot.court?.turn??0} data-lantern-motif={!props.snapshot.court&&props.snapshot.home.lantern?props.snapshot.home.motif:undefined} data-lantern-finish={!props.snapshot.court&&props.snapshot.home.lantern?props.snapshot.home.polished?"harbor_polish":"original":undefined} role="img" aria-label={props.snapshot.court?"Spatial tide court. Equivalent movement and interaction controls follow.":"Mochi and Bram at Pocket Harbor. Choose a place using the harbor controls."}/>;
}
