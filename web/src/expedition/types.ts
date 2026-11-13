export const CONTENT_VERSION = "first_light_v2" as const;
export const TURN_LIMIT = 24;
export type Column = 0 | 1 | 2;
export type Area = "beacon" | "wind";
export type Tool = "rope" | "lantern";
export type Find = "lens" | "moth" | "vane";
export type BankedItem = Find | "chart" | "salvage";
export type Direction = "north" | "south" | "west" | "east";
export type Phase = "low" | "rising" | "surge";
export interface Position { readonly x: Column; readonly y: number }
export type Command =
  | `step:${Direction}`
  | "wait" | "return" | "turn:vane"
  | `take:${Find}`
  | "reel:lens" | "reel:vane"
  | "lure:left" | "lure:center" | "lure:right";

export interface CourtStart {
  readonly area: Area;
  readonly tool: Tool;
  readonly banked: readonly BankedItem[];
}

export interface CourtState extends CourtStart {
  readonly contentVersion: typeof CONTENT_VERSION;
  readonly position: Position;
  readonly turn: number;
  readonly resolve: number;
  readonly uses: number;
  readonly orientation: Column;
  readonly locked: Column | null;
  readonly bridge: Column;
  readonly opened: readonly Column[];
  readonly cargo: readonly Find[];
  readonly commands: readonly Command[];
  readonly outcome: "active" | "returned" | "rescued";
}

export type CourtEvent =
  | { readonly kind: "move"; readonly from: Position; readonly to: Position }
  | { readonly kind: "telegraph"; readonly column: Column }
  | { readonly kind: "redirect"; readonly from: Column; readonly to: Column }
  | { readonly kind: "rotate"; readonly from: Column; readonly to: Column }
  | { readonly kind: "wave"; readonly source: Column; readonly exit: Column }
  | { readonly kind: "bridge"; readonly from: Column; readonly to: Column }
  | { readonly kind: "open"; readonly column: Column }
  | { readonly kind: "hit"; readonly from: Position; readonly to: Position; readonly resolve: number }
  | { readonly kind: "pickup"; readonly item: Find; readonly from: Position; readonly rope: boolean }
  | { readonly kind: "return"; readonly cargo: readonly Find[] }
  | { readonly kind: "rescue"; readonly reason: "resolve" | "flood" };

export interface CourtTransition {
  readonly before: CourtState;
  readonly after: CourtState;
  readonly events: readonly CourtEvent[];
}

export interface CourtDefinition {
  readonly area: Area;
  readonly title: string;
  readonly objective: Find;
  readonly initialOrientation: Column;
  readonly initialBridge: Column;
  readonly finds: Readonly<Partial<Record<Find, Position>>>;
}
