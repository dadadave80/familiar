import type { Area, BankedItem } from "./types";
import type { Landing } from "./passage-save";

interface Props {
  banked:readonly BankedItem[];
  lit:boolean;
  signaled:boolean;
  services:readonly Landing[];
  watched:boolean;
  heardBell:boolean;
  onSail:(area:Area)=>void;
  onCrossing:(job:Landing)=>void;
  onRepair:()=>void;
  onRest:()=>void;
  blocked:boolean;
}

export default function HarborChart({banked,lit,signaled,services,watched,heardBell,onSail,onCrossing,onRepair,onRest,blocked}:Props){
  const complete=signaled&&services.includes("bell")&&services.includes("reed");
  return <div className="harbor-chart">
    <h2>{complete?"A harbor connected.":"Where shall we go?"}</h2>
    <p>{complete?"Light on the headland. Supplies across the channel. A skiff tied up at home. You and Mochi made these crossings possible.":"The headland and both banks are within reach. Choose a place to visit."}</p>
    <ol className="harbor-routes">
      <li><span className="chart-place-mark" aria-hidden="true">☀</span><div><h3>Beacon Court</h3>
        <p>{lit?"The lighthouse is lit.":banked.includes("lens")?"The lens is home, ready to fit.":"Turn a surge into a way across. Bring the missing lens home."}</p>
        <button disabled={blocked} onClick={()=>banked.includes("lens")&&!lit?onRepair():onSail("beacon")}>{lit?"Revisit Beacon Court":banked.includes("lens")?"Fit the lens":"Sail to Beacon Court"}</button></div></li>
      <li><span className="chart-place-mark" aria-hidden="true">↝</span><div><h3>Wind Gate</h3>
        <p>{!lit?"Restore the beacon to open this passage.":signaled?"The recovered vane reads the wind from the quay.":banked.includes("vane")?"The vane is home. Bram has the post ready.":"Turn the wheel to steer the marked water into a different outlet."}</p>
        <button disabled={blocked||!lit} onClick={()=>banked.includes("vane")&&!signaled?onRepair():onSail("wind")}>{!lit?"Beacon needed":signaled?"Revisit Wind Gate":banked.includes("vane")?"Fit the Signal Vane":"Sail to Wind Gate"}</button></div></li>
      <li><span className="chart-place-mark" aria-hidden="true">↑</span><div><h3>Bell Steps</h3>
        <p>{services.includes("bell")?"Bram’s crates are stacked on the far work platform.":"Help Bram send his load from the near-left landing to the far worksite."}</p>
        {complete&&<p>{heardBell?"The old bell has a new pull. Call one surge left from the far-center landing.":"Mochi’s ears turn toward the far-left arch. Explore it at low water."}</p>}
        <button disabled={blocked||!lit} onClick={()=>onCrossing("bell")}>{!lit?"Beacon needed":complete?heardBell?"Try the bell pull":"Explore with Mochi":services.includes("bell")?"Sail Bell Steps again":"Send Bram’s supplies"}</button></div></li>
      <li><span className="chart-place-mark" aria-hidden="true">↓</span><div><h3>Reed Steps</h3>
        <p>{services.includes("reed")?"The skiff is moored beside the quay.":"Follow Mochi to the far-right reeds, then bring the empty skiff back."}{watched?" You watched the moth settle here together.":!banked.includes("moth")&&services.includes("reed")?" Mochi still watches the sheltered reeds. Try waiting together on the far shore.":""}{heardBell?" The bell pull offers another route.":""}</p>
        <button disabled={blocked||!lit} onClick={()=>onCrossing("reed")}>{!lit?"Beacon needed":services.includes("reed")?"Sail Reed Steps again":"Follow Mochi to Reed"}</button></div></li>
    </ol>
    {complete&&<button className="exp-primary" onClick={onRest}>Sit with Mochi</button>}
    <p className="chart-save-note">Crossing jobs and shared moments are remembered on this device.</p>
  </div>;
}
