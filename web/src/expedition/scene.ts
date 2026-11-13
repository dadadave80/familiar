import Phaser from "phaser";
import { applyCommand, waveExit, walkable, findPosition } from "./engine";
import { COURTS } from "./rooms";
import { commandAt } from "./input";
import { MOCHI_POSES, type MochiPoseName } from "../motion/mochi";
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
    this.bridgeArt=this.add.image(0,0,"exp-bridge").setDepth(.5);
    this.wheel=this.add.graphics().setDepth(6);
    this.forecast=this.add.graphics().setDepth(2);
    this.forecastLabel=this.add.text(0,0,"",{fontFamily:"Figtree Variable, sans-serif",fontStyle:"bold",color:"#fff5d8",backgroundColor:"#314d42",padding:{x:7,y:4},align:"center"}).setOrigin(.5).setDepth(12);
    this.neighbors=this.add.graphics().setDepth(2.1);
    this.effects=this.add.graphics().setDepth(20);
    this.keeper=this.add.image(0,0,"exp-keeper").setOrigin(.5,1).setDepth(3);
    this.bram=this.add.image(0,0,"exp-bram").setOrigin(.5,1).setDepth(5);
    this.actorShadow=this.add.ellipse(0,0,50,13,0x342719,.25).setDepth(7);
    this.actor=this.add.sprite(0,0,"exp-mochi",12).setOrigin(.5,.875).setDepth(10);
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
    else if(!this.playing){this.visual=snapshot.court;if(previous.court===snapshot.court&&snapshot.court&&previous.reducedMotion===snapshot.reducedMotion)this.paintHints(snapshot.court);else this.layout();if(!previous.court&&!snapshot.court&&!previous.home.lit&&snapshot.home.lit){this.beam.setAlpha(0);void this.tween(this.beam,{alpha:1},800);}}
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
    this.clearParts();this.ground.clear();this.homeProps.clear();this.bridgeArt.setAlpha(1);this.wheel.clear();this.forecast.clear();this.forecastLabel.setVisible(false);this.neighbors.clear();this.beam.clear().setAlpha(1);
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
      const position=COURTS[court.area].finds[item];if(!position||court.banked.includes(item)||court.cargo.includes(item))continue;
      const p=this.point(position);
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
    const p=this.point(court.position);this.actor.setPosition(p.x,p.y);this.actor.setDisplaySize(this.actorSize(),this.actorSize());this.actor.setFlipX(false);this.actorShadow.setPosition(p.x,p.y+2).setSize(this.actorSize()*.55,12);this.pose(court.locked!==null?"brace":"curious");
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
    this.forecast.clear();this.forecastLabel.setVisible(false);const preview=this.snapshot.previewCommand?applyCommand(court,this.snapshot.previewCommand):null;
    const predictedWave=preview?.events.find(event=>event.kind==="wave"),exit=predictedWave?.exit??waveExit(preview?.after??court);if(exit===null)return;
    const f=this.field(),p=this.point({x:exit,y:2}),width=this.tileSize().width*.7;
    this.forecast.fillStyle(0xc35235,.22);this.forecast.fillRoundedRect(p.x-width/2,f.top-30,width,f.bottom-f.top+65,12);
    this.forecast.lineStyle(3,0xf8be78,.95);this.forecast.strokeRoundedRect(p.x-width/2,f.top-30,width,f.bottom-f.top+65,12);
    for(let y=f.top+20;y<f.bottom;y+=50){this.forecast.lineBetween(p.x-9,y-7,p.x,y);this.forecast.lineBetween(p.x,y,p.x+9,y-7);}
    const target=this.point({x:exit,y:2});this.forecastLabel.setPosition(target.x,this.h<500?f.top+35:f.top-46).setFontSize(Math.min(14,this.w/27)).setText(`WAVE → ${["LEFT","CENTER","RIGHT"][exit]}`).setVisible(true);
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
      this.backdrop.x-=this.backdrop.displayWidth*.2;
      const source=this.textures.get("exp-island").getSourceImage() as HTMLImageElement;
      const pier=this.add.image(this.w*.40,groundY,"exp-island").setOrigin(.5,.41).setDisplaySize(this.w*.92,this.w*.92*source.height/source.width).setDepth(1);this.surfaces.push(pier);
    }
    const actorSize=Math.min(180,this.w*.28,this.h*.25);
    this.actor.setPosition(this.w*.49,groundY).setDisplaySize(actorSize,actorSize);this.pose(this.snapshot.home.lit?"relieved":"curious");this.actorShadow.setPosition(this.actor.x,this.actor.y).setSize(actorSize*.5,14);
    const b=Math.min(255,this.w*.36,this.h*.38);this.bram.setPosition(this.w*.28,portrait?groundY-4:this.h*.82).setDisplaySize(b*.75,b);
    if(this.snapshot.home.lit){this.beam.fillStyle(0xffe4a0,.24);this.beam.fillTriangle(this.w*.83,this.h*.25,this.w*.08,this.h*.39,this.w*.07,this.h*.58);}
    if(this.snapshot.home.moth)this.addHomeFind("moth",this.w*.57,this.h*.72,45);
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
    const epoch=++this.epoch;this.presentationSize={w:this.scale.width,h:this.scale.height};this.playing=true;this.visual=transition.before;this.layout();
    for(const [index,event] of transition.events.entries()){
      if(this.stopped||this.epoch!==epoch)return;
      this.hooks.beat(event,index);await this.presentEvent(event,transition.after);
    }
    if(this.stopped||this.epoch!==epoch)return;
    this.visual=transition.after;this.playing=false;this.presentationSize=null;this.cameras.main.setZoom(1).setScroll(0,0);this.layout();this.hooks.settled(id);
  }
  private async presentEvent(event:CourtEvent,after:CourtState){
    switch(event.kind){
      case "move":{
        const to=this.point(event.to),frames=[4,5,6,7],size=this.actorSize();this.actor.setFlipX(event.to.x<event.from.x);this.pose(event.to.x<event.from.x?"turn-left":"turn-right");await this.hold(70);
        await this.tween(this.actor,{x:to.x,y:to.y,onUpdate:()=>{if(!this.snapshot.reducedMotion)this.actor.setFrame(frames[Math.floor(this.time.now/75)%4]);this.actorShadow.setPosition(this.actor.x,this.actor.y+2);this.actor.setDisplaySize(size,size);for(const [i,item] of this.cargo.entries())item.setPosition(this.actor.x+(i?16:-18),this.actor.y-size*.35);}},330);
        this.actor.setFlipX(false);this.visual={...this.visual!,position:event.to};this.pose("curious");break;
      }
      case "telegraph":this.visual={...this.visual!,locked:event.column};this.pose("brace");this.drawForecast(this.visual);await this.hold(180);break;
      case "redirect":{this.pose("reach-left");const point=this.point({x:event.to,y:3});const light=this.add.circle(this.actor.x,this.actor.y-25,12,0xffdd8c,.95).setDepth(15);await this.tween(light,{x:point.x,y:point.y,alpha:.15},280);light.destroy();this.visual={...this.visual!,locked:event.to};this.drawForecast(this.visual);break;}
      case "rotate":this.pose("reach-left");await this.tween(this.wheel,{angle:(event.from+1)*120},260);this.visual={...this.visual!,orientation:event.to};this.layout();break;
      case "wave":{
        this.pose("brace");const f=this.field(),point=this.point({x:event.source,y:4}),exit=this.point({x:event.exit,y:4});const wave=this.add.image(point.x,f.top-70,"exp-wave").setDisplaySize(this.tileSize().width*1.15,90).setAlpha(.2).setDepth(14);
        if(event.source!==event.exit)await this.tween(wave,{x:exit.x,y:f.top+f.dy*.55,alpha:.8},230);
        await this.tween(wave,{y:f.bottom+35,alpha:1},480);await this.tween(wave,{alpha:0},90);wave.destroy();this.forecast.clear();this.visual={...this.visual!,locked:null};break;
      }
      case "bridge":await this.tween(this.bridgeArt,{alpha:0,y:this.bridgeArt.y+15},160);this.visual={...this.visual!,bridge:event.to};this.layout();{const resting=this.bridgeArt.y;this.bridgeArt.setAlpha(.2).setY(resting-10);await this.tween(this.bridgeArt,{alpha:1,y:resting},210);}break;
      case "open":{const shell=this.shells.get(event.column);if(shell)await this.tween(shell,{y:shell.y+15,scaleX:shell.scaleX*1.25,scaleY:shell.scaleY*.55,alpha:.35},230);this.visual={...this.visual!,opened:[...new Set([...this.visual!.opened,event.column])]};this.layout();break;}
      case "hit":{this.pose("startled");const p=this.point(event.to);await this.tween(this.actor,{x:p.x,y:p.y},300);this.visual={...this.visual!,position:event.to,resolve:event.resolve};this.layout();this.pose("relieved");break;}
      case "pickup":{
        this.pose("reach-ready");await this.hold(85);this.pose(event.rope?"pull-in":"reach-left");const from=this.point(event.from),find=this.finds.get(event.item)??this.add.image(from.x,from.y-20,`exp-${event.item}`).setDisplaySize(35,35).setDepth(14);
        const paw=()=>{const local=MOCHI_POSES[this.actorPose].paw;return{x:this.actor.x+(local.x-.5)*this.actor.displayWidth,y:this.actor.y+(local.y-.875)*this.actor.displayHeight};};
        await this.tween(find,{x:paw().x,y:paw().y,onUpdate:()=>{if(!event.rope)return;this.effects.clear();this.effects.lineStyle(3,0xf1d5a0);this.effects.lineBetween(paw().x,paw().y,find.x,find.y);}},event.rope?480:260);this.effects.clear();find.destroy();this.finds.delete(event.item);this.visual={...this.visual!,cargo:[...this.visual!.cargo,event.item]};this.drawCargo(this.visual);this.pose("relieved");await this.hold(140);break;
      }
      case "return":this.pose("relieved");await this.hold(360);break;
      case "rescue":this.pose("startled");await this.hold(360);break;
    }
  }
}
