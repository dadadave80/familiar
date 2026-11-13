import {useEffect,useId,useRef,useState} from "react";
import {loadRecords,type HarborRecord,type RecordsTarget} from "./records";

/** Opens on request; every line comes from a fresh public read. Remount with a new key when the account or Mochi changes. */
export default function HarborRecords({target}:{target:RecordsTarget}) {
  const [open,setOpen]=useState(false),[records,setRecords]=useState<HarborRecord[]|null>(null),[reading,setReading]=useState(false),[failed,setFailed]=useState(false);
  const request=useRef(0),id=useId();
  useEffect(()=>()=>{request.current++;},[]);
  async function read(){
    const mine=++request.current;setReading(true);setFailed(false);setRecords(null);
    try{const next=await loadRecords(target);if(mine===request.current)setRecords(next);}
    catch{if(mine===request.current)setFailed(true);}
    finally{if(mine===request.current)setReading(false);}
  }
  return <section className="exp-records" aria-label="Harbor records">
    <button aria-expanded={open} aria-controls={id} onClick={()=>{const next=!open;setOpen(next);if(next&&!records&&!reading)void read();}}>{open?"Fold the harbor records":"Read the harbor records"}</button>
    {open&&<div id={id}>
      <p className="exp-records-intro">Fresh reads of NEAR testnet’s public record. Each line says only what its read showed, or that it couldn’t be checked.</p>
      <p role="status" className="exp-records-status">{reading?"Reading the harbor records…":failed?"The harbor records couldn’t be read just now. Nothing here is confirmed.":""}</p>
      {records?.map(record=><article key={record.kind} className="exp-record" data-record={record.kind}>
        <h3>{record.title}</h3>
        <ul>{record.lines.map((line,index)=><li key={index} data-state={line.state}><span>{line.text}</span>{line.detail&&<small>{line.detail}</small>}</li>)}</ul>
      </article>)}
      {(records||failed)&&<button disabled={reading} onClick={()=>void read()}>Check again</button>}
    </div>}
  </section>;
}
