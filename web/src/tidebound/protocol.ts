import { CONTENT_VERSION, RULES_VERSION } from "./domain";

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
/** Both contracts must describe the same exact H1 stack before any canonical operation. */
export function assertTideboundProtocol(root:string,protocol:unknown,items:unknown,message="Initialized contracts do not form the compatible Tidebound tuple. No upgrade or migration will be attempted.") {
  if(!root.endsWith(".testnet")||!record(protocol)||!record(items)||protocol.registry!==root||protocol.items!==`items.${root}`||
    protocol.network!=="testnet"||protocol.rules_version!==RULES_VERSION||protocol.content_version!==CONTENT_VERSION||
    items.registry!==root||items.network!=="testnet"||items.rules_version!==RULES_VERSION||items.content_version!==CONTENT_VERSION)
    throw Error(message);
}
