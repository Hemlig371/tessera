import { AppError } from '../core/errors';
import type { Repository } from '../core/repository';
import { encryptedSyncMailbox } from '../core/encrypted-sync-mailbox';
import { importGroupKey } from '../core/secure-sync-envelope';
import { runLocalSyncCycle, type LocalSyncCycleResult } from '../core/local-sync-engine';
import { androidEmailTransport, type MailConnection, type MailCursor } from './sync-mail';
import { syncSecretStore } from './sync-secrets';

/** Explicit user action or foreground scheduler may call this; no background service.
 * Mail credentials and group key remain OS-protected at rest.
 */
export async function runAndroidMailSyncCycle(
  api:Repository, peers:readonly string[], connection:Omit<MailConnection,'password'>,
  limit=25
):Promise<LocalSyncCycleResult> {
  const vault=syncSecretStore();
  const password=await vault.load('mail-credentials');
  const groupSecret=await vault.load('group-key');
  if(!password || !groupSecret || !/^[A-Za-z0-9+/]{43}=$/.test(groupSecret))
    throw new AppError('secureStorageUnavailable');
  let bytes:Uint8Array;
  try { bytes=Uint8Array.from(atob(groupSecret),c=>c.charCodeAt(0)); }
  catch { throw new AppError('invalidSyncSecret'); }
  const key=await importGroupKey(bytes);
  bytes.fill(0);
  const row=await api.db.read(async s=>s.query<{value:string}>(
    'SELECT value FROM local_settings WHERE key=?',['sync_mail:cursor']));
  let cursor:MailCursor={uidValidity:null,lastUid:0};
  if(row[0]) {
    try {
      const saved=JSON.parse(row[0].value) as MailCursor;
      if((saved.uidValidity===null || /^\d+$/.test(saved.uidValidity)) &&
          Number.isSafeInteger(saved.lastUid) && saved.lastUid>=0 && saved.lastUid<=2147483647)
        cursor=saved;
    } catch { throw new AppError('invalidSyncState'); }
  }
  const {transport,commitCursor}=androidEmailTransport({...connection,password},cursor,api.datasetId,api.deviceId);
  const mailbox=encryptedSyncMailbox(transport,key,api.datasetId,api.deviceId);
  const result=await runLocalSyncCycle(api,mailbox,peers,limit);
  // The local inbox/outbox DB commits precede IMAP cursor advancement.
  const next=commitCursor();
  await api.db.transaction(s=>s.execute(
    'INSERT INTO local_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ['sync_mail:cursor',JSON.stringify(next)]));
  return result;
}
