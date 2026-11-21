import { AppError } from '../core/errors';
import type { Repository } from '../core/repository';
import { UUID_RE } from '../core/model';
import { createSyncInvitation, parseSyncInvitation } from '../core/sync-pairing';
import { type MailSyncConfig, validateMailSyncConfig } from '../core/mail-config';
import { syncSecretStore } from './sync-secrets';
import { runAndroidMailSyncCycle } from './mail-sync-cycle';
import type { LocalSyncCycleResult } from '../core/local-sync-engine';

async function localSetting(api:Repository,key:string):Promise<string|null> {
  const rows=await api.db.read(s=>s.query<{value:string}>(
    'SELECT value FROM local_settings WHERE key=?',['sync_mail:'+key]));
  return rows[0]?.value ?? null;
}
async function setLocal(api:Repository,key:string,value:string|null):Promise<void> {
  await api.db.transaction(s=>value===null
    ? s.execute('DELETE FROM local_settings WHERE key=?',['sync_mail:'+key])
    : s.execute('INSERT INTO local_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ['sync_mail:'+key,value]));
}
export async function readMailSyncConfig(api:Repository):Promise<MailSyncConfig|null> {
  const raw=await localSetting(api,'config');
  if(raw===null)return null;
  try {return validateMailSyncConfig(JSON.parse(raw) as MailSyncConfig,api.deviceId);}
  catch {throw new AppError('invalidSyncConfig');}
}
export async function configureAndroidMailSync(
  api:Repository,config:MailSyncConfig,password?:string
):Promise<void> {
  const value=validateMailSyncConfig(config,api.deviceId);
  if(password!==undefined && password!=='') {
    if(password.length>1024 || /[\r\n\0]/.test(password))throw new AppError('invalidSyncSecret');
    await syncSecretStore().store('mail-credentials',password);
  } else if(!(await syncSecretStore().load('mail-credentials')))
    throw new AppError('invalidSyncSecret');
  await setLocal(api,'config',JSON.stringify(value));
}
/** Explicit first-device action; never silently replaces a group key. */
export async function createAndroidSyncGroup(api:Repository):Promise<string> {
  const vault=syncSecretStore();
  if(await vault.load('group-key'))throw new AppError('invalidSyncState');
  const mode=(await api.localSyncSafety()).mode;
  if(mode!=='never_configured' && mode!=='detached')throw new AppError('invalidSyncState');
  const secret=crypto.getRandomValues(new Uint8Array(32));
  const value=btoa(String.fromCharCode(...secret));
  await vault.store('group-key',value);
  secret.fill(0);
  try {await api.startLocalSync();}
  catch(e){await vault.remove('group-key');throw e;}
  return await invitationForDevice(api);
}
export async function invitationForDevice(api:Repository):Promise<string> {
  const stored=await syncSecretStore().load('group-key');
  if(!stored)throw new AppError('secureStorageUnavailable');
  let raw:Uint8Array;
  try {raw=Uint8Array.from(atob(stored),c=>c.charCodeAt(0));}
  catch {throw new AppError('invalidSyncSecret');}
  try {return createSyncInvitation(api.datasetId,api.deviceId,raw);}
  finally {raw.fill(0);}
}
/** Requires prior local archive import; imported checkpoint was verified at import time. */
export async function joinAndroidSyncGroup(api:Repository,invitation:string):Promise<number> {
  const {datasetId,sourceId,secret}=parseSyncInvitation(invitation);
  if(datasetId!==api.datasetId || sourceId===api.deviceId)throw new AppError('invalidSyncState');
  const vault=syncSecretStore();
  if(await vault.load('group-key'))throw new AppError('invalidSyncState');
  await vault.store('group-key',btoa(String.fromCharCode(...secret)));
  secret.fill(0);
  try {
    const checkpoint=await api.registerImportedArchivePeer(sourceId);
    await api.startLocalSync();
    const existing=await readMailSyncConfig(api);
    if(existing)await setLocal(api,'config',JSON.stringify({...existing,peers:[sourceId]}));
    return checkpoint;
  } catch(e) {await vault.remove('group-key');throw e;}
}
/** The source owner explicitly verifies receiver identity and imported archive checkpoint. */
export async function confirmImportedPeer(
  api:Repository,peerId:string,checkpoint:number
):Promise<void> {
  if(!UUID_RE.test(peerId) || peerId===api.deviceId ||
      !Number.isSafeInteger(checkpoint) || checkpoint<0)throw new AppError('invalidSyncState');
  const head=await api.db.read(async s=>{
    const rows=await s.query<{seq:number}>('SELECT COALESCE(MAX(seq),0) AS seq FROM change_log');
    return rows[0]?.seq ?? 0;
  });
  if(checkpoint>head)throw new AppError('invalidSyncState');
  await api.acknowledgeLocalChanges(peerId,{dataset_id:api.datasetId,seq:checkpoint});
  const existing=await readMailSyncConfig(api);
  if(existing && !existing.peers.includes(peerId))
    await setLocal(api,'config',JSON.stringify({...existing,peers:[...existing.peers,peerId]}));
}
export async function executeAndroidMailCycle(api:Repository):Promise<LocalSyncCycleResult> {
  const config=await readMailSyncConfig(api);
  if(!config || config.peers.length===0)throw new AppError('invalidSyncState');
  const result=await runAndroidMailSyncCycle(api,config.peers,config);
  await setLocal(api,'last_error',null);
  await setLocal(api,'last_result',JSON.stringify(result));
  return result;
}
export async function stopAndroidMailGroup(api:Repository):Promise<void> {
  await api.detachLocalSync();
  const vault=syncSecretStore();
  await vault.remove('group-key');
  await vault.remove('mail-credentials');
  for(const key of ['config','cursor','last_error','last_result'])await setLocal(api,key,null);
}
export async function saveMailCycleError(api:Repository):Promise<void> {
  // No error message, credentials, user text, or packet bytes enter diagnostics.
  await setLocal(api,'last_error','mailTransportFailed');
}
