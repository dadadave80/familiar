import Phaser from "phaser";
import { applyCommand, waveExit, walkable, findPosition } from "./engine";
import { COURTS } from "./rooms";
import { commandAt } from "./input";
import { PASSAGE_LANDINGS, type PassageJob, type PassageState } from "./passage";
import { MOCHI_GROUND, MOCHI_POSES, walkingPose, type MochiPoseName } from "../motion/mochi";
import { companionIdle, type Attention } from "./companion";
import type { Column, Command, CourtEvent, CourtState, CourtTransition, Find, Position } from "./types";

const ART = "/assets/expedition/runtime/";
const ASSETS = { harbor:"harbor", mochi:"mochi-poses", keeper:"tidekeeper", shell:"shell", lens:"lens", moth:"moth", wave:"wave", bram:"bram" } as const;
export type HomePlace = "sail" | "beacon" | "bram" | "workbench" | "satchel" | "account" | "mochi";
export type PassageView=Pick<PassageState,"job"|"stage"|"watched"|"mothHome"|"bellRigged"|"heardBell"|"archOpen">&{rode?:boolean;listened?:boolean;rang?:boolean;pullSpent?:boolean};
export interface HarborView { lit:boolean; signaled:boolean; moth:boolean; lantern:boolean; socket:"porch"|"dock";motif:"crest"|"moth";polished:boolean;relic:"lens"|"vane"|null;resting?:boolean;services?:readonly PassageJob[];watchedReeds?:boolean;heardBell?:boolean;greeting?:number }
export interface WorldSnapshot { court:CourtState|null; home:HarborView; reducedMotion:boolean;previewCommand:Command|null;previewWave?:{source:Column;exit:Column};passage?:PassageView|null }
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
  private shownPassage:PassageView|null=null;
  private ground!:Phaser.GameObjects.Graphics;
  private shoreMarks!:Phaser.GameObjects.Graphics;
  private bridgeArt!:Phaser.GameObjects.Image;
  private wheel!:Phaser.GameObjects.Graphics;
  private shoreBell!:Phaser.GameObjects.Graphics;
  private skiff!:Phaser.GameObjects.Graphics;
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
  private signalVane!:Phaser.GameObjects.Image;
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
  private idleElapsed=0;
  private idleScale={x:1,y:1};
  private presentationSize:{w:number;h:number}|null=null;
  private get w(){return this.presentationSize?.w??this.scale.width;}
  private get h(){return this.presentationSize?.h??this.scale.height;}

  constructor(snapshot:WorldSnapshot,hooks:WorldHooks){super("expedition-world");this.snapshot=snapshot;this.hooks=hooks;}
  preload(){
    for(const [key,path] of Object.entries(ASSETS))this.load.image(`exp-${key}`,`${ART}${path}.webp`);
    this.load.image("exp-court",`${ART}tide-court.webp`);
    this.load.image("exp-island",`${ART}stone-island.webp`);
    this.load.image("exp-bridge",`${ART}wooden-bridge.webp`);
    this.load.on("loaderror",(file:Phaser.Loader.File)=>{this.stopped=true;this.hooks.fault(`The ${file.key.replace("exp-","")} artwork did not load. Your saved moves are safe. Retry the scene.`);});
  }
  create(){
    if(this.stopped)return;
    const missing=[...Object.keys(ASSETS),"court","island","bridge"].find(key=>!this.textures.exists(`exp-${key}`));
    if(missing){
      this.stopped=true;
      this.hooks.fault(`The ${missing} artwork could not be decoded. Your saved moves are safe. Retry the scene.`);
      return;
    }
    const atlas=this.textures.get("exp-mochi"),source=atlas.getSourceImage() as HTMLImageElement;
    for(let i=0;i<16;i++)atlas.add(i,0,(i%4)*source.width/4,Math.floor(i/4)*source.height/4,source.width/4,source.height/4);
    const vane=this.add.graphics();
    // The same swallowtail and brass boss travel from cradle to pack to signal post.
    vane.lineStyle(6,0x4d4031).lineBetween(31,29,31,54).lineBetween(9,29,51,29);
    vane.lineStyle(3,0xe3b36b).lineBetween(30,29,30,53).lineBetween(9,28,50,28);
    vane.fillStyle(0x4d4031).fillTriangle(2,9,24,23,22,31).fillTriangle(2,42,22,31,24,23).fillTriangle(43,15,63,28,43,37);
    vane.fillStyle(0x68877a).fillTriangle(5,13,21,23,20,28).fillTriangle(5,39,20,30,22,26);
    vane.fillStyle(0xf3c476).fillTriangle(45,18,60,28,45,34);
    vane.fillStyle(0x534635).fillCircle(31,28,7);
    vane.fillStyle(0xffda8a).fillCircle(30,27,4);
    vane.fillStyle(0x4d4031).fillRoundedRect(25,51,12,6,2);
    vane.generateTexture("exp-vane",64,64);vane.destroy();
    this.backdrop=this.add.image(0,0,"exp-harbor").setOrigin(.5).setDepth(-20);
    this.beam=this.add.graphics().setDepth(-2);
    this.homeProps=this.add.graphics().setDepth(6);
    this.ground=this.add.graphics().setDepth(0);
    this.shoreMarks=this.add.graphics().setDepth(4);
    this.bridgeArt=this.add.image(0,0,"exp-bridge").setDepth(.5);
    this.wheel=this.add.graphics().setDepth(6);
    this.shoreBell=this.add.graphics().setDepth(6);
    this.skiff=this.add.graphics().setDepth(8);
    this.forecast=this.add.graphics().setDepth(2);
    this.forecastLabel=this.add.text(0,0,"",{fontFamily:"Figtree Variable, sans-serif",fontStyle:"bold",color:"#fff5d8",backgroundColor:"#314d42",padding:{x:7,y:4},align:"center"}).setOrigin(.5).setDepth(12);
    this.neighbors=this.add.graphics().setDepth(2.1);
    this.effects=this.add.graphics().setDepth(20);
    this.keeper=this.add.image(0,0,"exp-keeper").setOrigin(.5,1).setDepth(3);
    this.bram=this.add.image(0,0,"exp-bram").setOrigin(.5,1).setDepth(5);
    this.signalVane=this.add.image(0,0,"exp-vane").setOrigin(31/64,54/64).setDepth(7).setVisible(false);
    this.actorShadow=this.add.ellipse(0,0,50,13,0x342719,.25).setDepth(7);
    this.actor=this.add.sprite(0,0,"exp-mochi",12).setOrigin(.5,MOCHI_GROUND).setDepth(10);
    this.actor.setInteractive({useHandCursor:true}).on("pointerdown",(pointer:Phaser.Input.Pointer)=>{
      if(!this.visual&&!this.gated&&this.onCanvas(pointer))this.presses.set(pointer.id,{target:"mochi",x:pointer.x,y:pointer.y,dragged:false});
    }).on("pointerup",(pointer:Phaser.Input.Pointer)=>{
      const press=this.presses.get(pointer.id);this.presses.delete(pointer.id);
      if(!this.visual&&!this.gated&&!pointer.wasCanceled&&press?.target==="mochi"&&!press.dragged&&
        Math.hypot(pointer.x-press.x,pointer.y-press.y)<=12&&(pointer.wasTouch||pointer.leftButtonReleased()))this.hooks.home("mochi");
    });
    this.scale.on("resize",()=>{
      if(this.playing&&this.presentationSize){const zoom=Math.min(this.scale.width/this.presentationSize.w,this.scale.height/this.presentationSize.h);this.cameras.main.setZoom(zoom).centerOn(this.presentationSize.w/2,this.presentationSize.h/2);}
      else{this.cameras.main.setZoom(1).setScroll(0,0);this.layout();}
    });
    this.events.once("shutdown",()=>{this.stopped=true;this.epoch++;});
    this.visual=this.snapshot.court;this.shownPassage=this.snapshot.passage??null;
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
    if(this.h<=500){const available=this.w-280,width=Math.max(240,Math.min(available*.91,760)),top=98,bottom=this.h-34;return{cx:available/2,width,top,bottom,dy:(bottom-top)/4,dx:width/3};}
    const top=portrait?(this.h<650?151:Math.max(200,this.h*.29)):this.h<500?122:Math.max(190,this.h*.31);
    const bottom=portrait?this.h-264:this.h-72;
    const width=Math.min(portrait?this.w*.84:this.h<500?this.w*.45:this.w*.50,760);
    return {cx:portrait?this.w*.5:this.h<500?this.w*.40:this.w*.45,width,top,bottom,dy:(bottom-top)/4,dx:width/3};
  }
  point(position:Position){const f=this.field();return{x:f.cx+(position.x-1)*f.dx,y:f.bottom-position.y*f.dy};}
  private tileSize(){const f=this.field();return{width:Math.min(f.dx*.99,220),height:Math.max(33,Math.min(f.dy*.65,72))};}
  private pose(name:MochiPoseName){this.actorPose=name;this.actor.setFrame(MOCHI_POSES[name].frame);}
  private attention():Attention {
    const court=this.visual,passage=this.shownPassage;
    if(!court){
      const home=this.snapshot.home,pendingArch=home.signaled&&home.services?.includes("bell")&&home.services.includes("reed")&&!home.heardBell;
      return home.resting?"rest":pendingArch?"left":home.moth?"right":"player";
    }
    if(court.outcome!=="active")return "rest";
    if(court.locked!==null)return "water";
    if(passage?.job==="bell"&&passage.archOpen&&court.opened.includes(0)&&!passage.heardBell&&!passage.bellRigged&&court.position.y>=3)return "left";
    if(court.position.y>=3&&findPosition(court,"moth")&&!passage?.mothHome)return "right";
    return "player";
  }
  private resetIdle(){
    this.idleElapsed=0;this.idleScale={x:this.actor.scaleX,y:this.actor.scaleY};
    this.actor.setAngle(0);
    if(this.snapshot.reducedMotion)this.pose(companionIdle(0,this.attention(),true).pose);
  }
  update(_time:number,delta:number){
    if(!this.actor||this.playing||this.gated||this.stopped||this.snapshot.reducedMotion||document.hidden)return;
    this.idleElapsed+=Math.min(delta,100);
    const idle=companionIdle(this.idleElapsed,this.attention(),false);
    if(this.idleElapsed>1200)this.pose(idle.pose);
    this.actor.setScale(this.idleScale.x,this.idleScale.y*idle.breath);
  }
  private actorSize(){return Math.min(this.field().dx*.66,this.field().dy*1.1,112);}
  private fit(image:Phaser.GameObjects.Image,width:number,height:number){const source=image.texture.getSourceImage() as HTMLImageElement;image.setScale(Math.max(width/source.width,height/source.height));}
  private text(x:number,y:number,text:string,size=14){const label=this.add.text(x,y,text,{fontFamily:"Figtree Variable, sans-serif",fontSize:`${size}px`,fontStyle:"bold",color:"#fff5d8",backgroundColor:"#314d42",padding:{x:7,y:4},align:"center"}).setOrigin(.5).setDepth(12);this.labels.push(label);return label;}

  setSnapshot(snapshot:WorldSnapshot, transition:CourtTransition|null, id:number){
    const previous=this.snapshot;this.snapshot=snapshot;if(!this.actor||this.stopped)return;
    if(transition&&id!==this.lastPresentation){this.lastPresentation=id;void this.present(transition,id);}
    else if(!this.playing){
      this.visual=snapshot.court;
      this.shownPassage=snapshot.passage??null;
      if(previous.court===snapshot.court&&snapshot.court&&previous.passage===snapshot.passage&&previous.reducedMotion===snapshot.reducedMotion)this.paintHints(snapshot.court);
      else this.layout();
      if(!previous.court&&!snapshot.court&&!previous.home.lit&&snapshot.home.lit&&!snapshot.reducedMotion){
        this.beam.setAlpha(.1);
        this.bram.setAngle(-4);
        void this.tween(this.beam,{alpha:1},620);
        void this.tween(this.bram,{angle:0},440);
      }
      if(!previous.court&&!snapshot.court&&previous.home.resting!==snapshot.home.resting&&snapshot.home.resting){
        const y=this.actor.y;
        if(snapshot.reducedMotion)this.actor.setY(y+3);
        else {this.actor.setY(y-3);void this.tween(this.actor,{y:y+3},260);}
      }
      if(!snapshot.court&&previous.home.greeting!==snapshot.home.greeting&&snapshot.home.greeting){
        this.pose("reach-ready");
        if(!snapshot.reducedMotion){
          this.idleElapsed=0;
          const greeting=snapshot.home.greeting;
          this.time.delayedCall(350,()=>{if(!this.visual&&!this.stopped&&this.snapshot.home.resting&&this.snapshot.home.greeting===greeting)this.pose("relieved");});
        }
      }
      if(!previous.court&&!snapshot.court&&previous.home.relic==="vane"&&!previous.home.signaled&&snapshot.home.signaled&&!snapshot.reducedMotion){
        this.signalVane.setAngle(-22);
        void this.tween(this.signalVane,{angle:0},400);
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
    this.skiff.clear().setVisible(false);this.shoreBell.clear().setAngle(0);
    this.clearParts();this.ground.clear();this.shoreMarks.clear();this.homeProps.clear();this.bridgeArt.setAlpha(1);this.wheel.clear();this.forecast.clear();this.forecastLabel.setVisible(false);this.neighbors.clear();this.beam.clear().setAlpha(1);
    const court=this.visual;
    this.backdrop.setTexture(court?"exp-court":"exp-harbor","__BASE");
    this.backdrop.setPosition(this.w/2,this.h/2);this.fit(this.backdrop,this.w,this.h);
    this.keeper.setVisible(!!court);this.bram.setVisible(!court);this.bridgeArt.setVisible(!!court);
    this.signalVane.setVisible(!court&&this.snapshot.home.signaled);
    if(!court){this.hooks.geometry([]);this.harbor();this.resetIdle();return;}
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
      zone.on("pointerdown",(pointer:Phaser.Input.Pointer)=>{if(!this.gated&&this.onCanvas(pointer))this.presses.set(pointer.id,{target,x:pointer.x,y:pointer.y,dragged:false});});
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
    const dock=this.point({x:1,y:0});if(!(portrait&&this.h<500&&court.position.x===1&&court.position.y===0))this.text(dock.x,dock.y+(this.h<500?-tile.height*.45:portrait?tile.height*.42:tile.height*.72),"DOCK",Math.min(14,this.w/28));
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
    if(court.area==="wind")this.windGate(court);
    if(this.shownPassage)this.passageCourt(court,this.shownPassage);
    const p=this.point(court.position);
    this.actor.setPosition(p.x,p.y).setDisplaySize(this.actorSize(),this.actorSize()).setFlipX(false);
    this.actorShadow.setPosition(p.x,p.y+2).setSize(this.actorSize()*.55,Math.max(4,this.actorSize()*.10));
    const mothNearby=court.position.y>=3&&findPosition(court,"moth")!==null&&!this.shownPassage?.mothHome;
    const watching=this.shownPassage?.watched&&mothNearby&&court.position.x===1&&court.position.y===4;
    this.pose(watching?"relieved":court.locked!==null?"brace":mothNearby?"look-right":"curious");
    this.drawCargo(court);this.paintHints(court);this.resetIdle();
  }
  private drawBridge(x:number,y:number,w:number,h:number){
    // Native3:1 bridge stays undistorted; transparent ends overlap the two landing stones.
    const length=h*1.36;this.bridgeArt.setPosition(x,y).setDisplaySize(length/3,length);
  }
  private supplyCrate(g:Phaser.GameObjects.Graphics,x:number,y:number,w:number){
    const h=w*.73;
    g.fillStyle(0x68462e).fillRect(x,y,w,h);
    g.fillStyle(0xb77b45).fillRect(x+1,y+1,w-2,h-2);
    g.lineStyle(Math.max(1,w*.09),0xe4bd82).lineBetween(x+2,y+h-2,x+w-2,y+2);
    for(const side of [.18,.80])g.lineStyle(Math.max(1,w*.09),0x6a5b43).lineBetween(x+w*side,y,x+w*side,y+h);
  }
  private drawSkiff(x:number,y:number,width:number,loaded:boolean){
    const hull=this.skiff;
    hull.clear().setVisible(true).setDepth(8).setPosition(x,y).setScale(width/80);
    hull.fillStyle(0x243d3e,.35).fillEllipse(1,7,77,11);
    hull.fillStyle(0x573d2c).beginPath().moveTo(-39,-8).lineTo(-25,4).lineTo(-16,9)
      .lineTo(22,9).lineTo(34,0).lineTo(40,-11).lineTo(23,-6).lineTo(-22,-5).closePath().fillPath();
    hull.fillStyle(0x547970).beginPath().moveTo(-35,-5).lineTo(-16,6).lineTo(22,6)
      .lineTo(35,-6).lineTo(20,-2).lineTo(-18,-1).closePath().fillPath();
    hull.lineStyle(2.2,0xe0b879).lineBetween(-38,-8,-20,-3).lineBetween(-20,-3,23,-4).lineBetween(23,-4,39,-11);
    hull.lineStyle(1.2,0x395b56).lineBetween(-19,4,21,3);
    hull.lineStyle(3,0xbc9366).lineBetween(12,-7,17,-3).lineBetween(-15,-7,-10,-3);
    if(loaded)this.supplyCrate(hull,-23,-18,16);
  }
  private passageCourt(court:CourtState,passage:PassageView){
    const bell=passage.job==="bell",side=bell?-1:1;
    const {departure,arrival}=PASSAGE_LANDINGS[passage.job],column=departure.x;
    const tile=this.tileSize(),f=this.field();
    const slipWidth=Math.min(90,tile.width*.74);
    const offset=side*tile.width*.17;
    const near=this.point({x:column,y:1}),far=this.point({x:column,y:3});
    const delivered=passage.stage==="delivered",boatAtNear=(delivered?arrival:departure).y===1;
    const slip=(boatAtNear?near:far);
    this.drawSkiff(slip.x+offset,slip.y+(boatAtNear?-1:1)*f.dy*.27,slipWidth,bell&&!delivered);
    const g=this.shoreMarks;
    const postX=near.x+side*tile.width*.35,nearY=near.y-f.dy*.12,farY=far.y+f.dy*.12;
    const taut=waveExit(court)===column&&!delivered;
    const midX=postX+(taut?0:side*Math.min(11,f.dx*.08)),midY=(nearY+farY)/2;
    g.lineStyle(4,0x4b4637,.83).lineBetween(postX,nearY,midX,midY).lineBetween(midX,midY,postX,farY);
    g.lineStyle(1.7,taut?0xffdf8c:0xc9ad79).lineBetween(postX,nearY,midX,midY).lineBetween(midX,midY,postX,farY);
    for(const y of [nearY,farY]){
      g.fillStyle(0x664a32).fillRoundedRect(postX-3,y-7,6,15,2);
      g.lineStyle(2,0xe3c393).lineBetween(postX-4,y-2,postX+4,y-2).lineBetween(postX-4,y+1,postX+4,y+1);
    }
    if(bell){
      g.lineStyle(3,0x60513b).lineBetween(postX,nearY-6,postX,nearY-22).lineBetween(postX,nearY-22,postX+10,nearY-22);
      g.fillStyle(0xdcb775).fillTriangle(postX+10,nearY-21,postX+5,nearY-12,postX+15,nearY-12).fillCircle(postX+10,nearY-11,2);
    }else{
      for(const dx of [-5,1,6]){
        g.lineStyle(2,0x52663f).lineBetween(postX+dx,farY,postX+dx-3,farY-11).lineBetween(postX+dx-3,farY-11,postX+dx+1,farY-15);
        g.fillStyle(0xba965a).fillEllipse(postX+dx+1,farY-17,3,6);
      }
    }
    if(bell&&delivered)this.supplyCrate(g,far.x-tile.width*.22,far.y-12,Math.max(12,tile.width*.15));
    if((bell&&passage.archOpen)||passage.bellRigged){
      const hollow=this.point({x:0,y:4}),r=Math.min(23,tile.width*.22),x=hollow.x-tile.width*.25,y=hollow.y-12;
      g.lineStyle(9,0x5c6658).beginPath().arc(x,y,r,Math.PI,0).strokePath();
      g.lineStyle(6,0xc2ad7c).beginPath().arc(x,y-1,r,Math.PI,0).strokePath();
      for(const a of [Math.PI*.2,Math.PI*.4,Math.PI*.6,Math.PI*.8])g.lineStyle(1,0x6c715c).lineBetween(x+Math.cos(a)*(r-4),y-Math.sin(a)*(r-4),x+Math.cos(a)*(r+3),y-Math.sin(a)*(r+3));
      const exposed=court.opened.includes(0)||passage.bellRigged;
      this.shoreBell.setPosition(x,y-r*.3);
      this.shoreBell.fillStyle(exposed?0xddb875:0x6b8a7c).fillTriangle(0,-r*.65,-r*.42,r*.15,r*.42,r*.15).fillCircle(0,r*.26,2);
      if(passage.bellRigged){
        const pull=this.point({x:1,y:3});
        g.lineStyle(1.5,passage.pullSpent?0x8c9581:0xe7c995).lineBetween(x,y-r,pull.x-tile.width*.24,pull.y-17);
        g.lineStyle(3,0x766047).lineBetween(pull.x-tile.width*.24,pull.y-25,pull.x-tile.width*.24,pull.y+2);
        g.lineStyle(2,passage.pullSpent?0x8c9581:0xffdb8d).strokeCircle(pull.x-tile.width*.24,pull.y-8,4);
      }
    }
    const crew=bell?far:near;
    const height=Math.min(64,f.dy*.77,tile.width*.53);
    this.bram.setVisible(true).setFlipX(!bell).setPosition(crew.x+side*tile.width*.27,crew.y+4).setDisplaySize(height*.75,height);
    const moth=this.finds.get("moth");
    if(moth&&passage.watched&&!passage.mothHome){
      const perch=this.point({x:2,y:4});
      moth.setPosition(perch.x+tile.width*.29,perch.y-15).setAngle(-12).setScale(moth.scaleX*.67,moth.scaleY*.67);
    }
  }
  private windGate(court:CourtState){
    const {width}=this.tileSize(),f=this.field(),stone=this.point({x:1,y:3});
    const radius=Math.max(9,Math.min(30,width*.20,f.dy*.34));
    const axleX=stone.x-width*.31,axleY=stone.y-radius*.58;
    const wood=0x594333,leather=0x916941,brass=0xe9c37d,iron=0x495f57,steel=0x91ae97;
    const base=this.shoreMarks,wheel=this.wheel;
    base.lineStyle(5,wood).lineBetween(axleX,axleY,axleX-radius*.45,stone.y+5).lineBetween(axleX,axleY,axleX+radius*.45,stone.y+5);
    base.lineStyle(2,brass).lineBetween(axleX,axleY-radius*1.02,axleX,axleY-radius*1.35);
    base.fillStyle(0xffe1a0).fillTriangle(axleX-3,axleY-radius*1.34,axleX+3,axleY-radius*1.34,axleX,axleY-radius*1.12);
    wheel.setPosition(axleX,axleY).setAngle(court.orientation*120);
    wheel.fillStyle(wood).fillCircle(0,0,radius*1.06).fillStyle(iron).fillCircle(0,0,radius*.91);
    wheel.lineStyle(2,steel).strokeCircle(0,0,radius*.90);
    for(let index=0;index<3;index++){
      const angle=index*Math.PI*2/3-Math.PI/2,dx=Math.cos(angle),dy=Math.sin(angle);
      wheel.fillStyle(index===0?brass:leather).fillTriangle(
        dx*radius*.16,dy*radius*.16,
        (dx*.90-dy*.09)*radius,(dy*.90+dx*.09)*radius,
        (dx*.68+dy*.40)*radius,(dy*.68-dx*.40)*radius,
      );
      wheel.lineStyle(2,0x544433).lineBetween(dx*radius*.20,dy*radius*.20,dx*radius*.84,dy*radius*.84);
      wheel.fillStyle(index===0?0xffe8a6:brass).fillCircle(dx*radius*.77,dy*radius*.77,Math.max(1.7,radius*.09));
    }
    wheel.fillStyle(wood).fillCircle(0,0,radius*.25).fillStyle(brass).fillCircle(-1,-1,radius*.15);
    const cradle=this.point({x:1,y:4});
    const hasVane=court.banked.includes("vane")||court.cargo.includes("vane");
    const ready=findPosition(court,"vane")!==null;
    const rackWidth=Math.min(24,width*.17),rackY=cradle.y-2;
    base.fillStyle(wood).fillRoundedRect(cradle.x-rackWidth,rackY-3,rackWidth*2,7,2);
    for(const side of [-1,1]){
      const x=cradle.x+side*rackWidth*.72;
      base.lineStyle(4,wood).lineBetween(x,rackY,x+side*(ready||hasVane?4:-2),rackY-9);
      base.fillStyle(brass).fillCircle(x,rackY,1.5);
    }
    const compact=this.h<540;
    if(!compact)this.text(cradle.x,cradle.y+Math.min(30,f.dy*.28),hasVane?"EMPTY CRADLE":ready?"VANE READY":"VANE CRADLE",Math.min(12,this.w/30));
    for(const column of [0,1] as const){
      const p=this.point({x:column,y:4});
      const x=p.x+(column===1?.33:-.12)*width,y=p.y-2,r=Math.max(5,Math.min(12,width*.10));
      const charged=court.opened.includes(column);
      base.fillStyle(wood).fillEllipse(x,y+2,r*2.18,r*2);
      base.fillStyle(brass).fillCircle(x,y,r).fillStyle(charged?0x457568:0x4a5148).fillCircle(x,y,r*.75);
      if(charged)base.lineStyle(2,0xffedbc).lineBetween(x-r*.44,y,x-r*.1,y+r*.32).lineBetween(x-r*.1,y+r*.32,x+r*.44,y-r*.4);
      else base.lineStyle(1.5,0xc5b28b).lineBetween(x-r*.36,y,x+r*.36,y);
    }
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
    const bellPreview=!this.playing?this.snapshot.previewWave:undefined;
    const predictedWave=bellPreview??preview?.events.find(event=>event.kind==="wave");
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
    if(source!==exit){
      const tip=p.x-Math.sign(p.x-mark.x)*9,tail=tip-Math.sign(p.x-mark.x)*8;
      this.forecast.lineStyle(4,0x424b40,.9).lineBetween(mark.x,sourceY,tip,sourceY);
      this.forecast.lineStyle(2,0xffdd91).lineBetween(mark.x,sourceY,tip,sourceY);
      this.forecast.fillStyle(0xffdd91).fillTriangle(tip,sourceY,tail,sourceY-4,tail,sourceY+4);
    }
    const lanes=["left","center","right"];
    const label=source===exit?`Next wave: ${lanes[exit]} lane`:`Next wave: ${lanes[source]} to ${lanes[exit]} lane`;
    this.forecastLabel.setPosition(p.x,this.h<500?f.top+35:f.top-46).setFontSize(Math.min(14,this.w/27)).setText(bellPreview?`With bell: ${lanes[exit]} lane`:label).setVisible(true);
  }
  /** Phaser hit-tests game objects even when a DOM card above the canvas took the press. */
  private onCanvas(pointer:Phaser.Input.Pointer){return pointer.downElement===this.game.canvas;}
  private paintHints(court:CourtState){
    this.neighbors.clear();const tile=this.tileSize();
    for(let y=0;y<5;y++)for(const x of [0,1,2] as const){const target={x,y},command=commandAt(court,target);if(!command)continue;const accepted=applyCommand(court,command);if(!accepted)continue;const risk=accepted.events.some(e=>e.kind==="hit"),p=this.point(target);this.neighbors.lineStyle(3,risk?0x8e3527:0xffe1a1,.95);
      if(this.shownPassage&&!command.startsWith("step:"))continue;
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
    const landscape=!portrait&&this.h<=500;
    const groundY=portrait?Math.max(230,this.h-522):landscape?this.h*.60:this.h*.81;
    const source=this.textures.get("exp-island").getSourceImage() as HTMLImageElement;
    const landing=(x:number,y:number,width:number)=>{
      const pier=this.add.image(x,y,"exp-island").setOrigin(.5,.41).setDisplaySize(width,width*source.height/source.width).setDepth(1);this.surfaces.push(pier);
    };
    if(portrait){
      this.fit(this.backdrop,this.w,this.h*1.16);this.backdrop.y=this.h-this.backdrop.displayHeight/2;
      const harborWidth=this.backdrop.displayWidth;
      const requestedX=this.w*.77-(.824-.5)*harborWidth;
      this.backdrop.x=Phaser.Math.Clamp(requestedX,this.w-harborWidth/2,harborWidth/2);
      landing(this.w*.40,groundY,this.w*.92);
      landing(this.w*.50,this.h-444,this.w*1.18);
    }
    if(landscape){landing(this.w*.40,groundY,this.w*.55);landing(this.w-224,this.h-146,440);}
    const actorSize=Math.min(180,this.w*.28,this.h*.25);
    this.actor.setPosition(this.w*(landscape?.43:.49),groundY).setDisplaySize(actorSize,actorSize);this.pose(this.snapshot.home.lit?"relieved":"curious");this.actorShadow.setPosition(this.actor.x,this.actor.y).setSize(actorSize*.5,14);
    const b=Math.min(255,this.w*.36,this.h*.38);this.bram.setFlipX(false).setPosition(this.w*(landscape?.23:.28),portrait?groundY-4:landscape?this.h*.59:this.h*.82).setDisplaySize(b*.75,b);
    const services=this.snapshot.home.services;
    if(services?.includes("bell")){
      const landing=this.homeProps,w=Math.min(27,actorSize*.18);
      const x=this.w*(portrait?.45:.54),y=this.backdrop.y+this.backdrop.displayHeight*(portrait?-.025:.05);
      landing.fillStyle(0x75573a).fillRoundedRect(x-w*.34,y+w*.84,w*2.48,w*.28,2);
      for(const edge of [-.15,1.65])landing.fillRect(x+w*edge,y+w,Math.max(2,w*.14),w*.47);
      this.supplyCrate(landing,x,y+w*.14,w);
      this.supplyCrate(landing,x+w*.88,y+w*.21,w*.83);
      this.supplyCrate(landing,x+w*.29,y-w*.42,w*.85);
    }
    if(services?.includes("reed")){
      const width=Math.min(130,this.w*.29);
      const x=this.w*(portrait?.13:.61),y=groundY-b*(portrait?.86:.67);
      this.drawSkiff(x,y,width,false);
      this.skiff.setDepth(4);
      this.homeProps.lineStyle(2,0xd0b17b).lineBetween(x+width*.44,y-width*.09,x+width*.57,y+width*.025);
      this.homeProps.fillStyle(0x674933).fillRoundedRect(x+width*.56,y-width*.05,Math.max(3,width*.045),width*.21,2);
    }
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
    if(this.snapshot.home.relic){
      const item=this.snapshot.home.relic,size=item==="vane"?Math.max(31,actorSize*.33):26;
      this.addHomeFind(item,this.actor.x+(item==="vane"?.31:-.31)*actorSize,groundY-actorSize*.42,size);
    }
    if(this.snapshot.home.lit){
      const x=portrait?this.w*.78:this.w*.70,y=portrait?groundY+8:this.h*.79;
      const height=Math.min(93,Math.max(63,this.h*.103)),top=y-height;
      const g=this.homeProps;
      g.fillStyle(0x60452e).fillRoundedRect(x-5,top,10,height,2);
      g.lineStyle(2,0xc39660).lineBetween(x-2,top+3,x-2,y-4);
      g.fillStyle(0x766346).fillRoundedRect(x-7,top,14,7,2).fillRect(x-6,top+height*.66,12,4);
      if(this.snapshot.home.signaled){
        this.signalVane.setPosition(x,top+3).setDisplaySize(height*.73,height*.73);
        this.actor.setFlipX(false);this.pose("look-right");
      }
    }
    if(this.snapshot.home.lantern){
      const porch=this.snapshot.home.socket==="porch",x=portrait?this.w*(porch?.72:.40):this.w*(porch?.19:.67),y=portrait?groundY+(porch?-25:30):this.h*(porch?.69:.84),g=this.homeProps;
      const frame=this.snapshot.home.polished?0x507e6c:0x8f6e3b;g.lineStyle(3,frame).strokeEllipse(x,y-35,16,17).fillStyle(frame).fillRoundedRect(x-15,y-32,30,40,5);
      g.fillStyle(this.snapshot.home.polished?0xffd18a:0xffd68b).fillRoundedRect(x-10,y-27,20,29,4).lineStyle(1.5,0x795328);
      if(this.snapshot.home.motif==="moth"){g.fillStyle(0xfff3c8).fillEllipse(x-5,y-15,9,13).fillEllipse(x+5,y-15,9,13).strokeEllipse(x-5,y-15,9,13).strokeEllipse(x+5,y-15,9,13).lineBetween(x,y-21,x,y-5);}
      else for(const offset of [-18,-9])g.lineBetween(x-8,y+offset,x-3,y+offset-3).lineBetween(x-3,y+offset-3,x+3,y+offset+3).lineBetween(x+3,y+offset+3,x+8,y+offset);
    }
    if(this.snapshot.home.watchedReeds||this.snapshot.home.resting)this.pose("relieved");
    if(this.snapshot.home.heardBell){
      const g=this.homeProps,x=this.w*(portrait?.65:.62),y=groundY+8;
      g.lineStyle(3,0x77583a).lineBetween(x,y,x,y-30).lineBetween(x,y-30,x+16,y-30);
      g.fillStyle(0xe3bc79).fillTriangle(x+15,y-28,x+9,y-17,x+22,y-17).fillCircle(x+15,y-15,2);
      g.lineStyle(1.5,0xe0bf86).lineBetween(x+15,y-13,x+15,y+2).strokeCircle(x+15,y+5,3);
    }
    const painted=(x:number,y:number)=>({x:this.backdrop.x+this.backdrop.displayWidth*(x-.5),y:this.backdrop.y+this.backdrop.displayHeight*(y-.5)});
    const signs=portrait?{
      workbench:{x:this.w/6,y:this.h-440},bram:{x:this.w/2,y:this.h-440},beacon:{x:this.w*5/6,y:this.h-440},satchel:{x:this.w*5/6,y:this.h-440},
    }:landscape?{
      workbench:{x:this.w-368,y:this.h-142},bram:{x:this.w-224,y:this.h-142},beacon:{x:this.w-80,y:this.h-142},satchel:{x:this.w-80,y:this.h-142},
    }:{
      bram:{x:this.w-272,y:this.h*.60},beacon:{x:this.w-88,y:this.h*.60},workbench:{x:this.w-272,y:this.h-198},satchel:{x:this.w-88,y:this.h-198},
    };
    const landmarks={bramFeet:{x:this.bram.x,y:this.bram.y},mochi:{x:this.actor.x,y:this.actor.y},beacon:painted(.824,.55),workbench:painted(.18,.70),lantern:{x:portrait?this.w*.72:this.w*.19,y:portrait?groundY-25:this.h*.69}};
    const root=this.game.canvas.closest<HTMLElement>(".exp-game");
    for(const [place,point] of Object.entries(signs))for(const axis of ["x","y"] as const)root?.style.setProperty(`--exp-anchor-${place}-${axis}`,`${point[axis]}px`);
    for(const axis of ["x","y"] as const)root?.style.setProperty(`--exp-anchor-mochi-${axis}`,`${landmarks.mochi[axis]}px`);
    if(this.game.canvas.parentElement)this.game.canvas.parentElement.dataset.harborAnchors=JSON.stringify({landmarks,signs});
  }
  private addHomeFind(item:Find,x:number,y:number,size:number){const image=this.add.image(x,y,`exp-${item}`).setDisplaySize(size,size).setDepth(item==="vane"?11:7);this.cargo.push(image);}
  private async tween(targets:object,config:Omit<Phaser.Types.Tweens.TweenBuilderConfig,"targets">,duration:number){
    if(this.stopped)return;await new Promise<void>(resolve=>this.tweens.add({...config,targets,duration:this.snapshot.reducedMotion?Math.min(duration,70):duration,ease:"Sine.easeInOut",onComplete:()=>resolve()}));
  }
  private async hold(duration:number){if(this.stopped)return;await new Promise<void>(resolve=>this.time.delayedCall(this.snapshot.reducedMotion?30:duration,()=>resolve()));}
  private async present(transition:CourtTransition,id:number){
    const epoch=++this.epoch;
    this.presentationSize={w:this.scale.width,h:this.scale.height};
    this.playing=true;
    this.visual=this.snapshot.reducedMotion?transition.after:transition.before;
    if(this.snapshot.reducedMotion)this.shownPassage=this.snapshot.passage??null;
    const beganWatching=this.snapshot.passage?.watched&&!this.shownPassage?.watched;
    const beganListening=this.snapshot.passage?.listened&&!this.shownPassage?.heardBell;
    this.layout();
    for(const [index,event] of transition.events.entries()){
      if(this.stopped||this.epoch!==epoch)return;
      this.hooks.beat(event,index);
      if(this.snapshot.reducedMotion||this.visual===transition.after){
        if(this.visual!==transition.after){this.visual=transition.after;this.shownPassage=this.snapshot.passage??null;this.layout();}
        await this.hold(30);
      }else await this.presentEvent(event);
    }
    if(this.stopped||this.epoch!==epoch)return;
    if(beganWatching&&!this.snapshot.reducedMotion){
      this.pose("look-right");
      const moth=this.finds.get("moth");
      if(moth)await this.tween(moth,{x:moth.x+this.tileSize().width*.29,angle:-12,scaleX:moth.scaleX*.67,scaleY:moth.scaleY*.67},180);
    }
    if(beganListening&&!this.snapshot.reducedMotion){
      this.pose("turn-left");await this.hold(220);
      this.pose("curious");await this.hold(320);
      this.pose("relieved");await this.hold(180);
    }
    if(this.stopped||this.epoch!==epoch)return;
    this.visual=transition.after;this.shownPassage=this.snapshot.passage??null;this.playing=false;this.presentationSize=null;this.cameras.main.setZoom(1).setScroll(0,0);this.layout();this.hooks.settled(id);
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
        if(crossing&&this.snapshot.passage?.rode&&this.skiff.visible){
          const deck={x:this.skiff.x,y:this.skiff.y-2};
          this.pose("reach-ready");
          await this.tween(this.actor,{...deck,onUpdate:()=>this.followActor()},95);
          this.pose("brace");
          const destinationY=to.y+(event.to.y===1?-1:1)*this.field().dy*.27;
          await this.tween(this.skiff,{y:destinationY,onUpdate:()=>{
            this.actor.setPosition(this.skiff.x,this.skiff.y-2);this.followActor();
          }},340);
          this.shownPassage=this.snapshot.passage;
          this.pose("turn-right");
          await this.tween(this.actor,{...to,onUpdate:()=>this.followActor()},90);
          this.visual={...this.visual!,position:event.to};this.pose("relieved");
          break;
        }
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
      case "redirect":{
        this.pose("reach-left");
        if(this.snapshot.passage?.rang){
          await this.hold(70);this.pose("pull-in");
          await this.tween(this.shoreBell,{angle:-13},90);
          await this.tween(this.shoreBell,{angle:9},110);
          await this.tween(this.shoreBell,{angle:0},140);
        }else{
          const point=this.point({x:event.to,y:3}),light=this.add.circle(this.actor.x,this.actor.y-25,12,0xffdd8c,.95).setDepth(15);
          await this.tween(light,{x:point.x,y:point.y,alpha:.15},280);light.destroy();
        }
        this.visual={...this.visual!,locked:event.to};this.drawForecast(this.visual);break;
      }
      case "rotate":{
        this.actor.setFlipX(false);this.pose("reach-ready");await this.hold(45);
        this.pose("reach-left");
        // Angle normalizes to ±180°. Animate rotation from the current value so every detent advances clockwise.
        const start=this.wheel.rotation;
        await this.tween(this.wheel,{rotation:start+Math.PI*2/3},205);
        this.pose("pull-in");await this.hold(45);
        this.visual={...this.visual!,orientation:event.to};this.layout();break;
      }
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
      case "open":{
        const shell=this.shells.get(event.column);
        if(shell)await this.tween(shell,{y:shell.y+15,scaleX:shell.scaleX*1.25,scaleY:shell.scaleY*.55,alpha:.35},230);
        this.visual={...this.visual!,opened:[...new Set([...this.visual!.opened,event.column])]};this.layout();
        if(this.visual.area==="wind")await this.hold(110);
        break;
      }
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
