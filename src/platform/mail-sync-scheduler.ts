import type { Repository } from '../core/repository';
import { executeAndroidMailCycle, readMailSyncConfig, saveMailCycleError } from './mail-sync-setup';

/** Foreground only: attempt on startup / return and then 15 minutes after last cycle.
 * Never claims background completion or delivery without applied peer ACKs.
 */
export function startAndroidMailScheduler(api:Repository):()=>void {
  let running=false,disposed=false,lastCycle=0;
  const tick=async(force:boolean)=>{
    if(disposed || running || document.hidden || (!force && Date.now()-lastCycle<15*60*1000))return;
    running=true;
    try {
      const config=await readMailSyncConfig(api);
      if(!config || config.schedule!=='15min' || config.peers.length===0)return;
      if((await api.localSyncSafety()).mode!=='active')return;
      lastCycle=Date.now();
      await executeAndroidMailCycle(api);
    } catch {await saveMailCycleError(api).catch(()=>{});}
    finally {running=false;}
  };
  const foreground=()=>{if(!document.hidden)void tick(true);};
  document.addEventListener('visibilitychange',foreground);
  window.addEventListener('focus',foreground);
  const timer=window.setInterval(()=>{void tick(false);},60*1000);
  void tick(true);
  return ()=>{
    disposed=true;
    document.removeEventListener('visibilitychange',foreground);
    window.removeEventListener('focus',foreground);
    window.clearInterval(timer);
  };
}
