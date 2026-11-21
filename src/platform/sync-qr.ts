import {Capacitor,registerPlugin} from '@capacitor/core';
import {AppError} from '../core/errors';
import {parseSyncInvitation} from '../core/sync-pairing';
const native=registerPlugin<{
  render(options:{value:string}):Promise<{image:string}>;
  scan():Promise<{cancelled:boolean;value?:string}>;
}>('SyncQr');
export async function renderSyncQr(invitation:string):Promise<string> {
  parseSyncInvitation(invitation);
  if(Capacitor.getPlatform()!=='android')throw new AppError('nativeRequired');
  return (await native.render({value:invitation})).image;
}
export async function scanSyncQr():Promise<string|null> {
  if(Capacitor.getPlatform()!=='android')throw new AppError('nativeRequired');
  const result=await native.scan();
  if(result.cancelled)return null;
  parseSyncInvitation(result.value ?? '');
  return result.value!;
}
