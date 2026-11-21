import { AppError } from './errors';
import { canonical, UUID_RE, type JsonValue } from './model';

/** QR content is a bearer secret: display only on a trusted device, never persist as a draft. */
export interface SyncInvitation {
  format: 'tessera-sync-invite';
  version: 1;
  dataset_id: string;
  source_id: string;
  group_key: string;
}
const fail = (): never => { throw new AppError('invalidSyncInvitation'); };
const encode = (bytes:Uint8Array) => {
  let result='';
  for(const b of bytes) result+=String.fromCharCode(b);
  return btoa(result);
};
export function createSyncInvitation(datasetId:string, sourceId:string, secret:Uint8Array):string {
  if (!UUID_RE.test(datasetId) || !UUID_RE.test(sourceId) || datasetId === sourceId || !(secret instanceof Uint8Array) || secret.length !== 32) return fail();
  return canonical({format:'tessera-sync-invite',version:1,dataset_id:datasetId,source_id:sourceId,
    group_key:encode(secret)} as JsonValue);
}
export function parseSyncInvitation(value:string):{datasetId:string;sourceId:string;secret:Uint8Array} {
  if (typeof value !== 'string' || value.length > 512) return fail();
  try {
    const obj = JSON.parse(value) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail();
    const v = obj as Record<string,unknown>;
    if (v.format !== 'tessera-sync-invite' || v.version !== 1 ||
        typeof v.dataset_id !== 'string' || !UUID_RE.test(v.dataset_id) ||
        typeof v.source_id !== 'string' || !UUID_RE.test(v.source_id) || v.source_id === v.dataset_id ||
        typeof v.group_key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(v.group_key) ||
        Object.keys(v).sort().join(',') !== 'dataset_id,format,group_key,source_id,version') return fail();
    const raw=atob(v.group_key);
    if (raw.length !== 32) return fail();
    const bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    if (encode(bytes)!==v.group_key) return fail();
    return {datasetId:v.dataset_id,sourceId:v.source_id,secret:bytes};
  } catch { return fail(); }
}
