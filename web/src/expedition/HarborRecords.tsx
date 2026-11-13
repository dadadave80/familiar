import {useEffect,useId,useRef,useState} from "react";
import {loadRecords,type HarborRecord,type RecordsTarget} from "./records";

/** Opens on request; every line comes from a fresh public read. Remount with a new key when the account or Mochi changes. */
export default function HarborRecords({target}:{target:RecordsTarget}) {
  const [open,setOpen]=useState(false),[records,setRecords]=useState<HarborRecord[]|null>(null),[reading,setReading]=useState(false),[failed,setFailed]=useState(false);
  const request=useRef(0),busy=useRef(false),id=useId();
  useEffect(()=>()=>{request.current++;},[]);
  async function read(){
    if(busy.current)return;
    const mine=++request.current;busy.current=true;setReading(true);setFailed(false);
    try{const next=await loadRecords(target);if(mine===request.current)setRecords(next);}
    catch{if(mine===request.current){setRecords(null);setFailed(true);}}
    finally{if(mine===request.current){busy.current=false;setReading(false);}}
  }
  return <section className="exp-records" aria-label="Harbor records">
    <button aria-expanded={open} aria-controls={id} onClick={()=>{const next=!open;setOpen(next);if(next&&!records)void read();}}>{open?"Fold the harbor records":"Read the harbor records"}</button>
    {open&&<div id={id}>
      <p className="exp-records-intro">Fresh reads of NEAR testnet’s public record. Each line says only what its read showed, or that it couldn’t be checked.</p>
      <p role="status" className="exp-records-status">{reading?records?"Reading the harbor records again. The lines below are from the last read.":"Reading the harbor records…":failed?"The harbor records couldn’t be read just now. Nothing here is confirmed.":""}</p>
      {records?.map(record=><article key={record.kind} className="exp-record" data-record={record.kind}>
        <h3>{record.title}</h3>
        <ul>{record.lines.map((line,index)=><li key={index} data-state={line.state}><span>{line.text}</span>{line.detail&&<small>{line.detail}</small>}</li>)}</ul>
      </article>)}
      {(records||failed)&&<button aria-disabled={reading} onClick={()=>void read()}>{reading?"Checking again…":"Check again"}</button>}
    </div>}
  </section>;
}
