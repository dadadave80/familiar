import { Buffer } from "buffer";
import browserProcess from "process/browser.js";

// Browser-only shims: process.env is empty and never receives server configuration.
if(typeof globalThis.process==="undefined")Object.defineProperty(globalThis,"process",{value:browserProcess,configurable:true});
if(typeof globalThis.Buffer==="undefined")Object.defineProperty(globalThis,"Buffer",{value:Buffer,writable:true,configurable:true});
if(!("global" in globalThis))Object.defineProperty(globalThis,"global",{value:globalThis,configurable:true});
