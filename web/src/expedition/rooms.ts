import type { Area, CourtDefinition } from "./types";

export const COURTS: Readonly<Record<Area, CourtDefinition>> = {
  beacon: {
    area:"beacon",title:"Beacon Court",objective:"lens",initialOrientation:0,initialBridge:1,
    finds:{lens:{x:0,y:4},moth:{x:2,y:4}},
  },
  wind: {
    area:"wind",title:"Wind Gate",objective:"vane",initialOrientation:1,initialBridge:1,
    finds:{vane:{x:1,y:4}},
  },
};
