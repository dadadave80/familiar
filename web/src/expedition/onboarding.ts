import type { TideBook } from "../run/save";
import type { HomeCheckpoint } from "./harbor-port";
import type { PassageHome } from "./passage-save";
import type { ReturnRecord } from "./return-record";

type DeviceSave = {
  home: HomeCheckpoint & { lantern: unknown | null };
  active: unknown | null;
  last: unknown | null;
};

export function isPristineHarbor(save:DeviceSave,book:TideBook,passage:PassageHome):boolean {
  return save.home.banked.length===0&&!save.home.lit&&!save.home.signaled&&save.home.lantern===null&&
    save.active===null&&save.last===null&&book.active===null&&book.days.length===0&&
    passage.active===null&&passage.services.length===0&&!passage.watchedReeds&&!passage.heardBell;
}

/** Legacy readers discard invalid entries; only verified absence or actual emptiness establishes freshness. */
export function hasPristineDeviceHistory(storage?:Pick<Storage,"getItem">):boolean {
  try {
    const store=storage??globalThis.localStorage;
    for(const key of ["familiar.tide.log.v1:preview","familiar.season.tide.v1:preview"]){
      const raw=store.getItem(key);
      if(raw!==null){const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.length!==0)return false;}
    }
    const pending=store.getItem("familiar.tide.pending.v1:preview");
    return pending===null||JSON.parse(pending)===null;
  }catch{return false;}
}

export function pristineDeviceHarbor(save:DeviceSave,book:TideBook,passage:PassageHome,returns:{ok:boolean;records:readonly ReturnRecord[]},storage?:Pick<Storage,"getItem">):boolean {
  return returns.ok&&returns.records.length===0&&isPristineHarbor(save,book,passage)&&hasPristineDeviceHistory(storage);
}
