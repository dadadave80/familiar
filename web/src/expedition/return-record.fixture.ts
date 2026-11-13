import type {ReturnRecordLock} from "./return-record";
/** Synthetic LockManager semantics for unit tests; production always uses real Web Locks. */
export function syntheticReturnLock():ReturnRecordLock {
  const queues=new Map<string,Promise<void>>();
  return async(name,work)=>{
    const prior=queues.get(name)??Promise.resolve();let release!:()=>void;
    const gate=new Promise<void>(resolve=>release=resolve),completion=prior.then(()=>gate);queues.set(name,completion);await prior;
    try{return await work();}finally{release();if(queues.get(name)===completion)queues.delete(name);}
  };
}
