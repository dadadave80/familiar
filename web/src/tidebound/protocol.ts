import { CONTENT_VERSION, RULES_VERSION } from "./domain";

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
/** Both contracts must describe the same exact H1 stack before any canonical operation. */
export function assertTideboundProtocol(root:string,protocol:unknown,items:unknown,message="Initialized contracts do not form the compatible Tidebound tuple. No upgrade or migration will be attempted.") {
  if(!root.endsWith(".testnet")||!record(protocol)||!record(items)||protocol.registry!==root||protocol.items!==`items.${root}`||
    protocol.network!=="testnet"||protocol.rules_version!==RULES_VERSION||protocol.content_version!==CONTENT_VERSION||
    items.registry!==root||items.network!=="testnet"||items.rules_version!==RULES_VERSION||items.content_version!==CONTENT_VERSION)
    throw Error(message);
}
export type SupportedContent="first_light_v1"|"first_light_v2";
export function supportsTideboundContent(root:string,protocol:unknown,items:unknown,content:SupportedContent):boolean {
  assertTideboundProtocol(root,protocol,items);
  if(content===CONTENT_VERSION)return true;
  const supports=(value:unknown)=>{
    if(!record(value))return false;const versions=value.supported_content_versions;
    return Array.isArray(versions)&&versions.length<=8&&new Set(versions).size===versions.length&&versions.every(v=>typeof v==="string"&&v.length<=48)&&versions.includes(CONTENT_VERSION)&&versions.includes(content);
  };
  return supports(protocol)&&supports(items);
}
export function assertTideboundContent(root:string,protocol:unknown,items:unknown,content:SupportedContent) {
  if(!supportsTideboundContent(root,protocol,items,content))throw Error("This harbor does not yet support owned items from the new expedition. Keep this return as a private memory; no new signature was requested.");
}
