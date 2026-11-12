/** Keep the original account-scoped preview before selecting a remote checkpoint. Never overwrite a different backup. */
export function preservePreview(storage:Pick<Storage,"getItem"|"setItem">,key:string,revision:number) {
  const raw=storage.getItem(key);if(raw===null)return;
  for(let index=0;index<64;index++) {
    const backup=`${key}:conflict:${revision}:${index}`,existing=storage.getItem(backup);
    if(existing===raw)return;
    if(existing===null){storage.setItem(backup,raw);if(storage.getItem(backup)!==raw)throw Error("The preview backup could not be verified.");return;}
  }
  throw Error("Preview backups are full. Export the earlier previews before selecting another harbor.");
}
