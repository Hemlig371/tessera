import { AppError } from '../core/errors';
import type { Repository } from '../core/repository';
import type { OpaqueSyncTransport } from '../core/encrypted-sync-mailbox';
import { decodeLocalPacket, parseLocalReceipt } from '../core/sync-protocol';
import { inspectSecureHeader, openSyncBytes } from '../core/secure-sync-envelope';

const prefix = 'sync_mail:stage:';
const MAX_WIRES = 2048;
const MAX_BYTES = 128 * 1024 * 1024;
/** Staged MIME bytes are authenticated AES-GCM envelopes, NOT plaintext.
 * Local SQLite is only an operational offline queue; archive/export never includes these rows.
 */
export function stageIncomingEmail(
  api: Repository, transport: OpaqueSyncTransport, chunks: () => Promise<readonly Uint8Array[]>,
  key: CryptoKey
): { transport: OpaqueSyncTransport; prune: () => Promise<void> } {
  const stored = new Map<string, Uint8Array>();
  let loaded = false;
  let captured = false;
  const bytesTo64 = (bytes: Uint8Array) => {
    let s = '';
    for (let i=0;i<bytes.length;i+=8192) s+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(s);
  };
  const from64 = (value:string) => {
    const raw=atob(value), bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return bytes;
  };
  const fingerprint = async (bytes:Uint8Array) => {
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));
    return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
  };
  const load = async () => {
    if(loaded)return;
    const rows=await api.db.read(s=>s.query<{key:string;value:string}>(
      "SELECT key,value FROM local_settings WHERE key LIKE 'sync_mail:stage:%' ORDER BY key LIMIT 2049"));
    if(rows.length>MAX_WIRES)throw new AppError('invalidLimit');
    for(const row of rows) {
      if(!/^sync_mail:stage:[0-9a-f]{64}$/.test(row.key))throw new AppError('invalidSyncState');
      let wire:Uint8Array;
      try {wire=from64(row.value);}
      catch {throw new AppError('invalidSyncState');}
      if(inspectSecureHeader(wire).dataset_id!==api.datasetId)throw new AppError('invalidSyncState');
      stored.set(row.key,wire);
    }
    loaded=true;
  };
  const ingest=async()=>{
    await load();
    if(captured)return;
    // A single native IMAP UID page is read once. No cursor is committed until M5 replay.
    const arriving=[...(await transport.list('packet')),...(await transport.list('receipt')),...(await chunks())];
    const fresh:{id:string;wire:Uint8Array}[]=[];
    let total=Array.from(stored.values()).reduce((sum,value)=>sum+value.length,0);
    for(const wire of arriving) {
      const h=inspectSecureHeader(wire);
      if(h.dataset_id!==api.datasetId || (h.sender_id===api.deviceId && h.kind!=='receipt'))continue;
      await openSyncBytes(key,wire,{dataset_id:api.datasetId,kind:h.kind});
      const id=prefix+await fingerprint(wire);
      if(stored.has(id))continue;
      total+=wire.length;
      if(stored.size+fresh.length>=MAX_WIRES || total>MAX_BYTES)throw new AppError('invalidLimit');
      fresh.push({id,wire});
    }
    if(fresh.length)await api.db.transaction(async s=>{
      for(const item of fresh)await s.execute(
        'INSERT OR IGNORE INTO local_settings(key,value) VALUES(?,?)',[item.id,bytesTo64(item.wire)]);
    });
    for(const item of fresh)stored.set(item.id,item.wire);
    captured=true;
  };
  const match=(kind:'chunk'|'packet'|'receipt',wire:Uint8Array,source?:string,id?:string,offset?:number)=>{
    const h=inspectSecureHeader(wire);
    return h.kind===kind && (source===undefined || h.sender_id===source) &&
      (id===undefined || h.message_id===id) && (offset===undefined || h.offset===offset);
  };
  const wrapped:OpaqueSyncTransport={
    list:async kind=>{
      await ingest();
      return [...stored.values()].filter(wire=>match(kind,wire));
    },
    send:(kind,wire)=>transport.send(kind,wire),
    attachments:transport.attachments && {
      put:(source,id,offset,wire)=>transport.attachments!.put(source,id,offset,wire),
      get:async(source,id,offset)=>{
        await ingest();
        const staged=[...stored.values()].find(w=>match('chunk',w,source,id,offset));
        return staged ?? transport.attachments!.get(source,id,offset);
      },
      exists:async(source,id,offset)=>{
        await ingest();
        return [...stored.values()].some(w=>match('chunk',w,source,id,offset)) ||
          !!(await transport.attachments!.exists?.(source,id,offset));
      },
    },
  };
  const prune=async()=>{
    if(!captured)return;
    const unused:string[]=[];
    for(const [id,wire] of stored) {
      const h=inspectSecureHeader(wire);
      const opened=await openSyncBytes(key,wire,{dataset_id:api.datasetId,kind:h.kind});
      if(h.kind==='packet') {
        const packet=decodeLocalPacket(opened.bytes);
        if(packet.sender_id===api.deviceId) {unused.push(id);continue;}
        const rx=await api.localSyncReceiveCursor(packet.sender_id);
        if(rx<packet.through_seq)continue;
        let missing=false;
        for(const event of packet.events) {
          if(event.entity_type!=='attachment' || event.payload.purged!==0 ||
              typeof event.payload.record_id!=='string')continue;
          try {
            const view=await api.getAttachmentView(event.entity_id,event.payload.record_id,true);
            if(!view.large && view.status!=='present'){missing=true;break;}
          } catch {missing=true;break;}
        }
        if(!missing)unused.push(id);
      } else if(h.kind==='receipt') {
        let receipt;
        try {receipt=parseLocalReceipt(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(opened.bytes)) as unknown);}
        catch {throw new AppError('invalidSyncPacket');}
        if(receipt.sender_id!==api.deviceId || (await api.localSyncPeerAck(receipt.receiver_id) ?? -1)>=receipt.through_seq)
          unused.push(id);
      } else {
        const rows=await api.db.read(s=>s.query<{record_id:string}>(
          'SELECT record_id FROM attachments WHERE id=?',[h.message_id]));
        if(!rows[0])continue; // Chunk can precede its metadata packet.
        try {
          const view=await api.getAttachmentView(h.message_id,rows[0].record_id,true);
          if(view.status==='present' || view.large)unused.push(id);
        } catch { /* still pending: keep encrypted bytes for retry */ }
      }
    }
    if(unused.length) {
      await api.db.transaction(async s=>{
        for(const id of unused)await s.execute('DELETE FROM local_settings WHERE key=?',[id]);
      });
      for(const id of unused)stored.delete(id);
    }
  };
  return {transport:wrapped,prune};
}
