// These deployed identifiers are frozen so existing earned items and requests remain recoverable.
export const RULES_VERSION = "tidebound_h1_v1";
export const CONTENT_VERSION = "first_light_v1";
export type Network = "testnet" | "mainnet";
export type MotifId = "crest" | "moth";
export type SocketId = "porch" | "dock";
export interface PlayerBinding {
  playerId:string;
  network:Network;
  nearAccountId:string;
  signerPublicKey:string;
  signerBindingId:string;
}
