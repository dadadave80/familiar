import Phaser from "phaser";
import { applyCommand, waveExit, walkable, findPosition } from "./engine";
import { COURTS } from "./rooms";
import { commandAt } from "./input";
import { MOCHI_GROUND, MOCHI_POSES, walkingPose, type MochiPoseName } from "../motion/mochi";
import type { Column, Command, CourtEvent, CourtState, CourtTransition, Find, Position } from "./types";

const ART = "/assets/expedition-v2/runtime/";
const ASSETS = { harbor:"harbor", mochi:"mochi-poses-v1", keeper:"tidekeeper", shell:"shell", lens:"lens", moth:"moth", wave:"wave", bram:"bram" } as const;
export type HomePlace = "sail" | "beacon" | "bram" | "workbench" | "satchel" | "account";
export interface HarborView { lit:boolean; signaled:boolean; moth:boolean; lantern:boolean; socket:"porch"|"dock";motif:"crest"|"moth";polished:boolean;relic:"lens"|"vane"|null }
export interface WorldSnapshot { court:CourtState|null; home:HarborView; reducedMotion:boolean;previewCommand:Command|null }
export interface WorldHooks {
  command:(command:Command)=>void;
  target:(position:Position)=>void;
  inspect:(position:Position)=>void;
  hover:(position:Position|null)=>void;
  home:(place:HomePlace)=>void;
  ready:()=>void;
  fault:(message:string)=>void;
  beat:(event:CourtEvent, index:number)=>void;
  settled:(id:number)=>void;
  geometry:(tiles:readonly {position:Position;x:number;y:number;width:number;height:number}[])=>void;
}

export class ExpeditionScene extends Phaser.Scene {
  private hooks:WorldHooks;
  private snapshot:WorldSnapshot;
  private visual:CourtState|null=null;
  private ground!:Phaser.GameObjects.Graphics;
  private shoreMarks!:Phaser.GameObjects.Graphics;
  private bridgeArt!:Phaser.GameObjects.Image;
  private wheel!:Phaser.GameObjects.Graphics;
  private forecast!:Phaser.GameObjects.Graphics;
  private forecastLabel!:Phaser.GameObjects.Text;
  private neighbors!:Phaser.GameObjects.Graphics;
  private effects!:Phaser.GameObjects.Graphics;
  private backdrop!:Phaser.GameObjects.Image;
  private actor!:Phaser.GameObjects.Sprite;
  private actorPose:MochiPoseName="curious";
  private actorShadow!:Phaser.GameObjects.Ellipse;
  private keeper!:Phaser.GameObjects.Image;
  private bram!:Phaser.GameObjects.Image;
  private beam!:Phaser.GameObjects.Graphics;
  private homeProps!:Phaser.GameObjects.Graphics;
  private finds=new Map<Find,Phaser.GameObjects.Image>();
  private shells=new Map<Column,Phaser.GameObjects.Image>();
  private labels:Phaser.GameObjects.Text[]=[];
  private cargo:Phaser.GameObjects.Image[]=[];
  private surfaces:Phaser.GameObjects.Image[]=[];
  private hitAreas:Phaser.GameObjects.Zone[]=[];
  private presses=new Map<number,{target:string;x:number;y:number;dragged:boolean}>();
  private epoch=0;
  private lastPresentation=0;
  private playing=false;
  private gated=false;
  private stopped=false;
  private presentationSize:{w:number;h:number}|null=null;
  private get w(){return this.presentationSize?.w??this.scale.width;}
  private get h(){return this.presentationSize?.h??this.scale.height;}

  constructor(snapshot:WorldSnapshot,hooks:WorldHooks){super("expedition-world");this.snapshot=snapshot;this.hooks=hooks;}
  preload(){
    for(const [key,path] of Object.entries(ASSETS))this.load.image(`exp-${key}`,`${ART}${path}.webp`);
    this.load.image("exp-court",`${ART}tide-court-v2.webp`);
    this.load.image("exp-island",`${ART}stone-island-v2.webp`);
    this.load.image("exp-bridge",`${ART}wooden-bridge-v2.webp`);
    this.load.on("loaderror",(file:Phaser.Loader.File)=>{this.stopped=true;this.hooks.fault(`The ${file.key.replace("exp-","")} artwork did not load. Your saved moves are safe. Retry the scene.`);});
  }
  create(){
    if(this.stopped)return;
    const atlas=this.textures.get("exp-mochi"),source=atlas.getSourceImage() as HTMLImageElement;
    for(let i=0;i<16;i++)atlas.add(i,0,(i%4)*source.width/4,Math.floor(i/4)*source.height/4,source.width/4,source.height/4);
    const vane=this.add.graphics();vane.lineStyle(7,0x745831).lineBetween(31,8,31,59).lineBetween(7,27,54,27);vane.lineStyle(4,0xe8c677).lineBetween(31,9,31,58).lineBetween(8,27,54,27);vane.fillStyle(0xe8c677).fillTriangle(50,15,50,39,63,27).fillRect(3,18,15,18).fillCircle(31,27,6);vane.generateTexture("exp-vane",64,64);vane.destroy();
    this.backdrop=this.add.image(0,0,"exp-harbor").setOrigin(.5).setDepth(-20);
    this.beam=this.add.graphics().setDepth(-2);
    this.homeProps=this.add.graphics().setDepth(6);
    this.ground=this.add.graphics().setDepth(0);
    this.shoreMarks=this.add.graphics().setDepth(4);
    this.bridgeArt=this.add.image(0,0,"exp-bridge").setDepth(.5);
    this.wheel=this.add.graphics().setDepth(6);
    this.forecast=this.add.graphics().setDepth(2);
    this.forecastLabel=this.add.text(0,0,"",{fontFamily:"Figtree Variable, sans-serif",fontStyle:"bold",color:"#fff5d8",backgroundColor:"#314d42",padding:{x:7,y:4},align:"center"}).setOrigin(.5).setDepth(12);
    this.neighbors=this.add.graphics().setDepth(2.1);
    this.effects=this.add.graphics().setDepth(20);
    this.keeper=this.add.image(0,0,"exp-keeper").setOrigin(.5,1).setDepth(3);
    this.bram=this.add.image(0,0,"exp-bram").setOrigin(.5,1).setDepth(5);
    this.actorShadow=this.add.ellipse(0,0,50,13,0x342719,.25).setDepth(7);
    this.actor=this.add.sprite(0,0,"exp-mochi",12).setOrigin(.5,MOCHI_GROUND).setDepth(10);
    this.scale.on("resize",()=>{
      if(this.playing&&this.presentationSize){const zoom=Math.min(this.scale.width/this.presentationSize.w,this.scale.height/this.presentationSize.h);this.cameras.main.setZoom(zoom).centerOn(this.presentationSize.w/2,this.presentationSize.h/2);}
      else{this.cameras.main.setZoom(1).setScroll(0,0);this.layout();}
    });
    this.events.once("shutdown",()=>{this.stopped=true;this.epoch++;});
    this.visual=this.snapshot.court;
    this.input.mouse?.disableContextMenu();
    this.input.on("pointermove",(pointer:Phaser.Input.Pointer)=>{const press=this.presses.get(pointer.id);if(press&&Math.hypot(pointer.x-press.x,pointer.y-press.y)>12)press.dragged=true;});
    const release=(pointer:Phaser.Input.Pointer)=>this.presses.delete(pointer.id);
    this.input.on("pointerup",release);this.input.on("pointerupoutside",release);
    this.layout();this.hooks.ready();
  }

  /** Presentation coordinates are responsive. Logical cells and accepted state never resize. */
  private field(){
    const portrait=this.w<=900&&this.h>this.w;
    if(portrait&&this.h<500){const top=144,bottom=this.h-166,width=this.w*.82;return{cx:this.w/2,width,top,bottom,dy:(bottom-top)/4,dx:width/3};}
    if(this.h<500){const available=this.w-260,width=Math.max(240,Math.min(available*.91,760)),top=98,bottom=this.h-34;return{cx:available/2,width,top,bottom,dy:(bottom-top)/4,dx:width/3};}
    const top=portrait?(this.h<650?151:Math.max(200,this.h*.29)):this.h<500?122:Math.max(190,this.h*.31);
    const bottom=portrait?this.h-240:this.h-72;
    const width=Math.min(portrait?this.w*.84:this.h<500?this.w*.45:this.w*.50,760);
    return {cx:portrait?this.w*.5:this.h<500?this.w*.40:this.w*.45,width,top,bottom,dy:(bottom-top)/4,dx:width/3};
  }
  point(position:Position){const f=this.field();return{x:f.cx+(position.x-1)*f.dx,y:f.bottom-position.y*f.dy};}
  private tileSize(){const f=this.field();return{width:Math.min(f.dx*.99,220),height:Math.max(33,Math.min(f.dy*.65,72))};}
  private pose(name:MochiPoseName){this.actorPose=name;this.actor.setFrame(MOCHI_POSES[name].frame);}
  private actorSize(){return Math.min(this.field().dx*.66,this.field().dy*1.1,112);}
  private fit(image:Phaser.GameObjects.Image,width:number,height:number){const source=image.texture.getSourceImage() as HTMLImageElement;image.setScale(Math.max(width/source.width,height/source.height));}
  private text(x:number,y:number,text:string,size=14){const label=this.add.text(x,y,text,{fontFamily:"Figtree Variable, sans-serif",fontSize:`${size}px`,fontStyle:"bold",color:"#fff5d8",backgroundColor:"#314d42",padding:{x:7,y:4},align:"center"}).setOrigin(.5).setDepth(12);this.labels.push(label);return label;}

  setSnapshot(snapshot:WorldSnapshot, transition:CourtTransition|null, id:number){
    const previous=this.snapshot;this.snapshot=snapshot;if(!this.actor||this.stopped)return;
    if(transition&&id!==this.lastPresentation){this.lastPresentation=id;void this.present(transition,id);}
    else if(!this.playing){
      this.visual=snapshot.court;
      if(previous.court===snapshot.court&&snapshot.court&&previous.reducedMotion===snapshot.reducedMotion)this.paintHints(snapshot.court);
      else this.layout();
      if(!previous.court&&!snapshot.court&&!previous.home.lit&&snapshot.home.lit&&!snapshot.reducedMotion){
        this.beam.setAlpha(.1);
        this.bram.setAngle(-4);
        void this.tween(this.beam,{alpha:1},620);
        void this.tween(this.bram,{angle:0},440);
      }
    }
  }
  setGated(gated:boolean){this.gated=gated;if(gated)this.presses.clear();if(!this.actor)return;this.input.enabled=!gated;this.time.paused=gated;if(gated)this.tweens.pauseAll();else this.tweens.resumeAll();}
  private clearParts(){
    for(const label of this.labels)label.destroy();this.labels=[];
    for(const zone of this.hitAreas)zone.destroy();this.hitAreas=[];
    for(const find of this.finds.values())find.destroy();this.finds.clear();
    for(const shell of this.shells.values())shell.destroy();this.shells.clear();
    for(const item of this.cargo)item.destroy();this.cargo=[];
    for(const image of this.surfaces)image.destroy();this.surfaces=[];
  }
  private layout(){
    if(!this.actor||this.stopped)return;
    this.presses.clear();
    this.clearParts();this.ground.clear();this.shoreMarks.clear();this.homeProps.clear();this.bridgeArt.setAlpha(1);this.wheel.clear();this.forecast.clear();this.forecastLabel.setVisible(false);this.neighbors.clear();this.beam.clear().setAlpha(1);
    const court=this.visual;
    this.backdrop.setTexture(court?"exp-court":"exp-harbor","__BASE");
    this.backdrop.setPosition(this.w/2,this.h/2);this.fit(this.backdrop,this.w,this.h);
    this.keeper.setVisible(!!court);this.bram.setVisible(!court);this.bridgeArt.setVisible(!!court);
    if(!court){this.hooks.geometry([]);this.harbor();return;}
    const f=this.field(),tile=this.tileSize();
    // Fixed short walks connect each bank. Only the long middle crossing changes with a surge.
    for(const y of [0,3])for(const x of [0,1,2] as const){const from=this.point({x,y}),to=this.point({x,y:y+1}),length=f.dy*1.35;const link=this.add.image(from.x,(from.y+to.y)/2,"exp-bridge").setDisplaySize(length/3,length).setDepth(.4);this.surfaces.push(link);}
    const targets:Parameters<WorldHooks["geometry"]>[0][number][]=[];
    for(let y=0;y<5;y++)for(let x=0;x<3;x++){
      const position={x:x as Column,y},p=this.point(position),available=walkable(court,position);
      if(y!==2)this.platform(p.x,p.y,tile.width,court.opened.includes(x as Column)&&y===4);
      else if(available)this.drawBridge(p.x,p.y,tile.width*.58,f.dy*1.65);
      else {this.ground.lineStyle(2,0xa8c8bd,.4);this.ground.strokeEllipse(p.x,p.y+6,tile.width*.6,tile.height*.45);}
      const hitHeight=Math.max(44,Math.min(tile.height+15,f.dy-2));
      const zone=this.add.zone(p.x,p.y,Math.max(44,tile.width),hitHeight).setInteractive({useHandCursor:true}).setDepth(16);
      const target=`${x},${y}`;
      zone.on("pointerdown",(pointer:Phaser.Input.Pointer)=>{if(!this.gated)this.presses.set(pointer.id,{target,x:pointer.x,y:pointer.y,dragged:false});});
      zone.on("pointerup",(pointer:Phaser.Input.Pointer)=>{
        const press=this.presses.get(pointer.id);this.presses.delete(pointer.id);
        if(this.gated||pointer.wasCanceled||!press||press.target!==target||press.dragged||Math.hypot(pointer.x-press.x,pointer.y-press.y)>12)return;
        if(pointer.rightButtonReleased()||pointer.getDuration()>450)this.hooks.inspect(position);
        else if(pointer.wasTouch||pointer.leftButtonReleased())this.hooks.target(position);
      });this.hitAreas.push(zone);
      zone.on("pointerover",()=>{if(!this.gated&&!this.playing)this.hooks.hover(position);});zone.on("pointerout",()=>this.hooks.hover(null));
      targets.push({position,x:p.x,y:p.y,width:Math.max(44,tile.width),height:hitHeight});
    }
    this.hooks.geometry(targets);
    const portrait=this.w<=900&&this.h>this.w;
    const dock=this.point({x:1,y:0});if(!(portrait&&this.h<500&&court.position.x===1&&court.position.y===0))this.text(dock.x,dock.y+(this.h<500?-tile.height*.45:tile.height*.72),"DOCK",Math.min(14,this.w/28));
    const keeperHeight=Math.min(this.h<500?f.top-(portrait?78:15):230,this.h*.26,portrait?this.w*(this.h<650?.38:.45):this.w*.52,portrait?f.top-(this.h<650?15:80):Infinity);this.keeper.setPosition(this.h<500&&!portrait?f.cx+Math.min(60,f.width*.18):portrait&&this.h<650?this.w*.72:f.cx,f.top-8).setDisplaySize(keeperHeight*1.32,keeperHeight);
    for(const item of ["lens","moth","vane"] as const){
      const position=COURTS[court.area].finds[item];if(!position)continue;
      const p=this.point(position);
      // A brass ring and bent reeds keep the two Beacon shelves distinct in silhouette.
      if(item==="lens"){
        const x=p.x-tile.width*.34,y=p.y+1,r=Math.max(4,tile.width*.045);
        this.shoreMarks.lineStyle(3,0x57472f).lineBetween(x,y+r,x,y+r*2.3).strokeCircle(x,y,r);
        this.shoreMarks.lineStyle(1.5,0xf8d386).strokeCircle(x,y,r);
      }else if(item==="moth"){
        const x=p.x+tile.width*.25,y=p.y+5,length=Math.min(28,tile.width*.24);
        for(const spread of [-.18,.14,.46]){
          const tip=x+length*spread;
          this.shoreMarks.lineStyle(2.5,0x51613c).lineBetween(x,y,tip,y-length*.76).lineBetween(tip,y-length*.76,tip+length*.2,y-length);
          this.shoreMarks.fillStyle(0xc6a66d).fillEllipse(tip+length*.2,y-length,3,7);
        }
      }
      if(court.banked.includes(item)||court.cargo.includes(item))continue;
      if(item!=="vane"&&!findPosition(court,item)){
        const shell=this.add.image(p.x,p.y-15,"exp-shell").setDisplaySize(tile.width*.64,tile.width*.64).setDepth(5);this.shells.set(position.x,shell);
      }else if(findPosition(court,item)){
        const find=this.add.image(p.x,p.y-15,`exp-${item}`).setDisplaySize(item==="moth"?51:36,item==="moth"?46:36).setDepth(6);this.finds.set(item,find);
      }
    }
    if(court.area==="wind"){
      const vane=this.point({x:1,y:3});this.text(vane.x,vane.y+tile.height*.65,`WHEEL ${court.orientation===0?"ALIGNED":"TURN"}`,Math.min(13,this.w/27));
      this.wheel.setPosition(vane.x,vane.y-7).setAngle(court.orientation*120);
      const radius=Math.min(tile.width*.22,36);this.wheel.fillStyle(0x54442b).fillCircle(0,0,radius+3);this.wheel.lineStyle(4,0xe0bc73).strokeCircle(0,0,radius);
      for(let n=0;n<3;n++){const angle=n*2*Math.PI/3-Math.PI/2;this.wheel.lineBetween(0,0,Math.cos(angle)*radius,Math.sin(angle)*radius);}
      this.wheel.fillStyle(0xfce0a1).fillTriangle(-7,-radius+6,7,-radius+6,0,-radius-8).fillCircle(0,0,6);
      const cradle=this.point({x:1,y:4});this.text(cradle.x,cradle.y+tile.height*.8,`CRADLE ${court.orientation===0?"ALIGNED":"LOCKED"}`,Math.min(12,this.w/30));
      for(const x of [0,1] as const){const p=this.point({x,y:4});this.ground.fillStyle(court.opened.includes(x)?0xffd580:0x8d7861,1);this.ground.fillCircle(p.x,p.y,8);}
    }
    const p=this.point(court.position);
    this.actor.setPosition(p.x,p.y).setDisplaySize(this.actorSize(),this.actorSize()).setFlipX(false);
    this.actorShadow.setPosition(p.x,p.y+2).setSize(this.actorSize()*.55,Math.max(4,this.actorSize()*.10));
    const mothNearby=court.position.y>=3&&findPosition(court,"moth")!==null;
    this.pose(court.locked!==null?"brace":mothNearby?"look-right":"curious");
    this.drawCargo(court);this.paintHints(court);
  }
  private drawBridge(x:number,y:number,w:number,h:number){
    // Native3:1 bridge stays undistorted; transparent ends overlap the two landing stones.
    const length=h*1.36;this.bridgeArt.setPosition(x,y).setDisplaySize(length/3,length);
  }
  private platform(x:number,y:number,w:number,charged:boolean){
      this.ground.fillStyle(0x183c3d,.22).fillEllipse(x,y+w*.1,w*1.05,w*.18);
      this.ground.lineStyle(1,0xe5edce,.35).strokeEllipse(x,y+w*.10,w*1.09,w*.24);
      const source=this.textures.get("exp-island").getSourceImage() as HTMLImageElement;
      const image=this.add.image(x,y,"exp-island").setOrigin(.5,.41).setDisplaySize(w,w*source.height/source.width).setDepth(1);if(charged)image.setTint(0xffe3a3);this.surfaces.push(image);
  }
  private drawForecast(court:CourtState){
    this.forecast.clear();
    this.forecastLabel.setVisible(false);
    const preview=this.snapshot.previewCommand?applyCommand(court,this.snapshot.previewCommand):null;
    const predictedWave=preview?.events.find(event=>event.kind==="wave");
    const exit=predictedWave?.exit??waveExit(preview?.after??court);
    const source=predictedWave?.source??(preview?.after??court).locked;
    this.keeper.setAngle(source===null?0:(source-1)*3).setTint(source===null?0xffffff:0xe5ddc9);
    if(exit===null||source===null)return;
    const f=this.field(),p=this.point({x:exit,y:2}),width=this.tileSize().width*.7;
    this.forecast.fillStyle(0xc35235,.22);this.forecast.fillRoundedRect(p.x-width/2,f.top-30,width,f.bottom-f.top+65,12);
    this.forecast.lineStyle(3,0xf8be78,.95);this.forecast.strokeRoundedRect(p.x-width/2,f.top-30,width,f.bottom-f.top+65,12);
    for(let y=f.top+20;y<f.bottom;y+=50){this.forecast.lineBetween(p.x-9,y-7,p.x,y);this.forecast.lineBetween(p.x,y,p.x+9,y-7);}
    const mark=this.point({x:source,y:4}),sourceY=f.top+Math.min(27,f.dy*.44);
    this.forecast.lineStyle(3,0x4e4534).strokeCircle(mark.x,sourceY,8);
    this.forecast.lineStyle(2,0xffdf96).strokeCircle(mark.x,sourceY,6);
    if(source!==exit)this.forecast.lineBetween(mark.x,sourceY,p.x,sourceY);
    const lanes=["L","C","R"];
    const label=source===exit?`IN + OUT · ${["LEFT","CENTER","RIGHT"][exit]}`:`IN ${lanes[source]} → OUT ${lanes[exit]}`;
    this.forecastLabel.setPosition(p.x,this.h<500?f.top+35:f.top-46).setFontSize(Math.min(14,this.w/27)).setText(label).setVisible(true);
  }
  private paintHints(court:CourtState){
    this.neighbors.clear();const tile=this.tileSize();
    for(let y=0;y<5;y++)for(const x of [0,1,2] as const){const target={x,y},command=commandAt(court,target);if(!command)continue;const accepted=applyCommand(court,command);if(!accepted)continue;const risk=accepted.events.some(e=>e.kind==="hit"),p=this.point(target);this.neighbors.lineStyle(3,risk?0x8e3527:0xffe1a1,.95);
      if(command.startsWith("step:"))this.neighbors.strokeEllipse(p.x,p.y+tile.width*.025,tile.width*1.03,tile.width*.36);
      else if(command.startsWith("take:")||command.startsWith("reel:"))this.neighbors.strokeCircle(p.x,p.y-15,Math.min(33,tile.width*.37));
      if(risk)this.neighbors.lineBetween(p.x-7,p.y-7,p.x+7,p.y+7).lineBetween(p.x+7,p.y-7,p.x-7,p.y+7);
    }
    this.drawForecast(court);
  }
  private drawCargo(court:CourtState){
    for(const item of this.cargo)item.destroy();this.cargo=[];
    for(const [i,item] of court.cargo.entries()){
      const image=this.add.image(this.actor.x+(i?16:-18),this.actor.y-this.actor.displayHeight*.35,`exp-${item}`).setDisplaySize(item==="moth"?30:22,item==="moth"?26:22).setDepth(11);this.cargo.push(image);
    }
  }
  private harbor(){
    const portrait=this.w<=900&&this.h>this.w;
    const groundY=portrait?this.h-(this.h<500?235:316):this.h*.81;
    if(portrait){
      const harborWidth=this.backdrop.displayWidth;
      const requestedX=this.w*.77-(.824-.5)*harborWidth;
      this.backdrop.x=Phaser.Math.Clamp(requestedX,this.w-harborWidth/2,harborWidth/2);
      const source=this.textures.get("exp-island").getSourceImage() as HTMLImageElement;
      const pier=this.add.image(this.w*.40,groundY,"exp-island").setOrigin(.5,.41).setDisplaySize(this.w*.92,this.w*.92*source.height/source.width).setDepth(1);this.surfaces.push(pier);
    }
    const actorSize=Math.min(180,this.w*.28,this.h*.25);
    this.actor.setPosition(this.w*.49,groundY).setDisplaySize(actorSize,actorSize);this.pose(this.snapshot.home.lit?"relieved":"curious");this.actorShadow.setPosition(this.actor.x,this.actor.y).setSize(actorSize*.5,14);
    const b=Math.min(255,this.w*.36,this.h*.38);this.bram.setPosition(this.w*.28,portrait?groundY-4:this.h*.82).setDisplaySize(b*.75,b);
    if(this.snapshot.home.lit){
      // Register the light to the painted lantern room, including its portrait crop.
      const width=this.backdrop.displayWidth,height=this.backdrop.displayHeight;
      const x=this.backdrop.x+width*(.824-.5),y=this.backdrop.y+height*(.222-.5);
      const glow=width*.019;
      this.beam.fillStyle(0xffdc88,.12).fillTriangle(x,y,-4,y+this.h*.065,-4,y+this.h*.24);
      this.beam.fillStyle(0xffffc9,.14).fillTriangle(x,y,-4,y+this.h*.11,-4,y+this.h*.19);
      this.beam.fillStyle(0xffcd65,.18).fillEllipse(x,y,glow*2.1,glow*1.6);
      for(let ring=7;ring>0;ring--){
        this.beam.fillStyle(0xffdc8a,.09).fillEllipse(x,y,glow*ring*.21,glow*ring*.17);
      }
      this.beam.fillStyle(0xffedae,.95).fillEllipse(x,y,glow*.31,glow*.48);
      // Register broken glints to the water under the tower in the painted harbor.
      for(let ripple=0;ripple<5;ripple++){
        const rx=this.backdrop.x+width*(.59-.5)-ripple*width*.014;
        const ry=this.backdrop.y+height*(.53-.5)+ripple*height*.012;
        this.beam.fillStyle(0xffda90,.37-ripple*.045).fillEllipse(rx,ry,width*(.017+ripple*.002),Math.max(1,height*.002));
      }
    }
    if(this.snapshot.home.moth){
      const perchX=this.actor.x+actorSize*.37;
      this.addHomeFind("moth",perchX,groundY-actorSize*.76,Math.min(45,actorSize*.30));
      this.pose("look-right");
    }
    if(this.snapshot.home.relic)this.addHomeFind(this.snapshot.home.relic,this.actor.x-15,groundY-actorSize*.34,26);
    if(this.snapshot.home.lit){const x=portrait?this.w*.78:this.w*.73,y=portrait?groundY+8:this.h*.79;this.homeProps.lineStyle(6,0x795a37).lineBetween(x,y,x,y-80);this.homeProps.lineStyle(2,0xead2a0).lineBetween(x-3,y-2,x-3,y-80);if(this.snapshot.home.signaled)this.addHomeFind("vane",x,y-83,53);}
    if(this.snapshot.home.lantern){
      const porch=this.snapshot.home.socket==="porch",x=portrait?this.w*(porch?.72:.40):this.w*(porch?.19:.67),y=portrait?groundY+(porch?-25:30):this.h*(porch?.69:.84),g=this.homeProps;
      const frame=this.snapshot.home.polished?0x507e6c:0x8f6e3b;g.lineStyle(3,frame).strokeEllipse(x,y-35,16,17).fillStyle(frame).fillRoundedRect(x-15,y-32,30,40,5);
      g.fillStyle(this.snapshot.home.polished?0xffd18a:0xffd68b).fillRoundedRect(x-10,y-27,20,29,4).lineStyle(1.5,0x795328);
      if(this.snapshot.home.motif==="moth"){g.fillStyle(0xfff3c8).fillEllipse(x-5,y-15,9,13).fillEllipse(x+5,y-15,9,13).strokeEllipse(x-5,y-15,9,13).strokeEllipse(x+5,y-15,9,13).lineBetween(x,y-21,x,y-5);}
      else for(const offset of [-18,-9])g.lineBetween(x-8,y+offset,x-3,y+offset-3).lineBetween(x-3,y+offset-3,x+3,y+offset+3).lineBetween(x+3,y+offset+3,x+8,y+offset);
    }
  }
  private addHomeFind(item:Find,x:number,y:number,size:number){const image=this.add.image(x,y,`exp-${item}`).setDisplaySize(size,size).setDepth(7);this.cargo.push(image);}
  private async tween(targets:object,config:Omit<Phaser.Types.Tweens.TweenBuilderConfig,"targets">,duration:number){
    if(this.stopped)return;await new Promise<void>(resolve=>this.tweens.add({...config,targets,duration:this.snapshot.reducedMotion?Math.min(duration,70):duration,ease:"Sine.easeInOut",onComplete:()=>resolve()}));
  }
  private async hold(duration:number){if(this.stopped)return;await new Promise<void>(resolve=>this.time.delayedCall(this.snapshot.reducedMotion?30:duration,()=>resolve()));}
  private async present(transition:CourtTransition,id:number){
    const epoch=++this.epoch;
    this.presentationSize={w:this.scale.width,h:this.scale.height};
    this.playing=true;
    this.visual=this.snapshot.reducedMotion?transition.after:transition.before;
    this.layout();
    for(const [index,event] of transition.events.entries()){
      if(this.stopped||this.epoch!==epoch)return;
      this.hooks.beat(event,index);
      if(this.snapshot.reducedMotion||this.visual===transition.after){
        if(this.visual!==transition.after){this.visual=transition.after;this.layout();}
        await this.hold(30);
      }else await this.presentEvent(event);
    }
    if(this.stopped||this.epoch!==epoch)return;
    this.visual=transition.after;this.playing=false;this.presentationSize=null;this.cameras.main.setZoom(1).setScroll(0,0);this.layout();this.hooks.settled(id);
  }
  private followActor(){
    this.actorShadow.setPosition(this.actor.x,this.actor.y+2);
    for(const [index,item] of this.cargo.entries()){
      item.setPosition(this.actor.x+(index?16:-18),this.actor.y-this.actor.displayHeight*.35);
    }
  }
  private async presentEvent(event:CourtEvent){
    switch(event.kind){
      case "move":{
        const from=this.point(event.from),to=this.point(event.to);
        const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
        const crossing=Math.abs(event.to.y-event.from.y)===2;
        this.pose(dx<0?"turn-left":dx>0?"turn-right":dy<0?"curious":"brace");
        await this.hold(crossing?45:30);
        this.actor.setFlipX(dx<0);
        await this.tween(this.actor,{
          x:to.x,y:to.y,ease:"Sine.easeInOut",
          onUpdate:()=>{
            const progress=distance===0?1:Math.min(1,Math.hypot(this.actor.x-from.x,this.actor.y-from.y)/distance);
            this.pose(walkingPose(progress*(crossing?2:1)));
            this.followActor();
          },
        },crossing?310:185);
        this.visual={...this.visual!,position:event.to};
        this.actor.setFlipX(false);this.pose(dx<0?"turn-left":dx>0?"turn-right":"neutral");
        await this.hold(35);break;
      }
      case "telegraph":this.visual={...this.visual!,locked:event.column};this.pose("brace");this.drawForecast(this.visual);await this.hold(180);break;
      case "redirect":{this.pose("reach-left");const point=this.point({x:event.to,y:3});const light=this.add.circle(this.actor.x,this.actor.y-25,12,0xffdd8c,.95).setDepth(15);await this.tween(light,{x:point.x,y:point.y,alpha:.15},280);light.destroy();this.visual={...this.visual!,locked:event.to};this.drawForecast(this.visual);break;}
      case "rotate":this.pose("reach-left");await this.tween(this.wheel,{angle:(event.from+1)*120},260);this.visual={...this.visual!,orientation:event.to};this.layout();break;
      case "wave":{
        this.pose("brace");const f=this.field(),point=this.point({x:event.source,y:4}),exit=this.point({x:event.exit,y:4});const wave=this.add.image(point.x,f.top-70,"exp-wave").setDisplaySize(this.tileSize().width*1.15,90).setAlpha(.2).setDepth(14);
        if(event.source!==event.exit)await this.tween(wave,{x:exit.x,y:f.top+f.dy*.55,alpha:.8},165);
        await this.tween(wave,{y:f.bottom+20,alpha:.9},330);
        void this.tween(wave,{y:f.bottom+32,alpha:0},115).then(()=>wave.destroy());
        this.forecast.clear();this.forecastLabel.setVisible(false);this.visual={...this.visual!,locked:null};break;
      }
      case "bridge":{
        const berth=this.point({x:event.to,y:2}),direction=event.to>event.from?1:-1;
        await this.tween(this.bridgeArt,{angle:direction*1.8,y:berth.y+3,alpha:.88},55);
        await this.tween(this.bridgeArt,{x:berth.x,y:berth.y+2,angle:-direction*.7},190);
        await this.tween(this.bridgeArt,{angle:0,y:berth.y,alpha:1},70);
        this.visual={...this.visual!,bridge:event.to};this.layout();break;
      }
      case "open":{const shell=this.shells.get(event.column);if(shell)await this.tween(shell,{y:shell.y+15,scaleX:shell.scaleX*1.25,scaleY:shell.scaleY*.55,alpha:.35},230);this.visual={...this.visual!,opened:[...new Set([...this.visual!.opened,event.column])]};this.layout();break;}
      case "hit":{this.pose("startled");const p=this.point(event.to);await this.tween(this.actor,{x:p.x,y:p.y,onUpdate:()=>this.followActor()},215);this.visual={...this.visual!,position:event.to,resolve:event.resolve};this.layout();this.pose("relieved");break;}
      case "pickup":{
        const from=this.point(event.from);
        this.actor.setFlipX(from.x>this.actor.x);this.pose("reach-ready");await this.hold(60);
        this.pose("reach-left");
        const find=this.finds.get(event.item)??this.add.image(from.x,from.y-20,`exp-${event.item}`).setDisplaySize(35,35).setDepth(14);
        const local=MOCHI_POSES[this.actorPose].paw,side=this.actor.flipX?-1:1;
        const paw={x:this.actor.x+(local.x-.5)*this.actor.displayWidth*side,y:this.actor.y+(local.y-MOCHI_GROUND)*this.actor.displayHeight};
        await this.tween(find,{...paw,onUpdate:()=>{
          if(event.rope)this.effects.clear().lineStyle(3,0xf1d5a0).lineBetween(paw.x,paw.y,find.x,find.y);
        }},event.rope?345:180);
        this.effects.clear();this.pose("pull-in");
        find.destroy();this.finds.delete(event.item);this.visual={...this.visual!,cargo:[...this.visual!.cargo,event.item]};
        this.drawCargo(this.visual);await this.hold(55);this.actor.setFlipX(false);this.pose("relieved");await this.hold(70);break;
      }
      case "return":this.pose("relieved");await this.hold(360);break;
      case "rescue":this.pose("startled");await this.hold(360);break;
    }
  }
}
