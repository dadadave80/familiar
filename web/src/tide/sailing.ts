export function tideSailReason(state:{
  lit:boolean;lease:"waiting"|"held"|"blocked"|"unavailable";problem:string;run:boolean;
  worldReady:boolean;showPassage:boolean;busy?:boolean;pending?:boolean;
}):string|null {
  if(state.lease==="blocked")return "This expedition is open in another tab. Finish there, or close that tab before continuing here.";
  if(state.lease==="unavailable")return "This browser cannot safely coordinate saved expeditions. Web Locks support is required; no move has been taken.";
  if(state.lease==="waiting")return "Checking whether this tab can sail.";
  if(state.problem)return state.problem;
  if(state.run)return "Finish the outing in progress first.";
  if(!state.worldReady)return "Opening the artwork. Mochi’s saved moves are safe.";
  if(state.showPassage)return "Finish the harbor crossing first.";
  if(state.busy)return "The original harbor action is still being checked.";
  if(state.pending)return "Resolve the original request before setting out from this harbor.";
  if(!state.lit)return "Restore the beacon before sailing today’s tide.";
  return null;
}
