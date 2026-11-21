import { Capacitor, registerPlugin } from '@capacitor/core';
import { AppError } from '../core/errors';
import { inspectSecureHeader } from '../core/secure-sync-envelope';
import type { OpaqueSyncTransport } from '../core/encrypted-sync-mailbox';

export interface MailConnection {
  smtpHost:string; smtpPort:number; imapHost:string; imapPort:number;
  user:string; password:string; address:string;
}
export interface MailCursor { uidValidity:string|null; lastUid:number }
interface MailItem {uid:number;kind:'packet'|'receipt'|'chunk';source:string;id:string;offset:number;payload:string}
const native=registerPlugin<{
  send(args:MailConnection&{kind:string;source:string;id:string;offset:number;payload:string}):Promise<void>;
  fetch(args:MailConnection&{afterUid:number;limit:number}):Promise<{uidValidity:string;maxUid:string;messages:MailItem[]}>;
}>('SyncMail');
const from64=(s:string):Uint8Array=>{
  const raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const to64=(bytes:Uint8Array):string=>{
  let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);
};
/** Cursor is committed ONLY after runLocalSyncCycle returns. Never advance on a failed apply. */
export function androidEmailTransport(
  connection:MailConnection,cursor:MailCursor,datasetId:string,deviceId:string
):{transport:OpaqueSyncTransport;commitCursor:()=>MailCursor;reset:()=>void} {
  if(Capacitor.getPlatform()!=='android')throw new AppError('nativeRequired');
  let batch:MailItem[]|null=null;
  let pending:MailCursor={...cursor};
  const fetch=async()=>{
    if(batch)return batch;
    const response=await native.fetch({...connection,afterUid:cursor.lastUid,limit:128});
    if(!/^\d+$/.test(response.uidValidity))throw new AppError('mailTransportFailed');
    if(cursor.uidValidity!==null && cursor.uidValidity!==response.uidValidity){
      const fresh=await native.fetch({...connection,afterUid:0,limit:128});
      batch=fresh.messages;
      pending={uidValidity:fresh.uidValidity,lastUid:batch.length < 128 ? Number(fresh.maxUid) : Math.max(0,...batch.map(m=>m.uid))};
    } else {
      batch=response.messages;
      pending={uidValidity:response.uidValidity,lastUid:batch.length < 128 ? Number(response.maxUid) : Math.max(cursor.lastUid,...batch.map(m=>m.uid))};
    }
    if(batch.length>128 || !Number.isSafeInteger(pending.lastUid) || pending.lastUid<0 || pending.lastUid>2147483647)throw new AppError('mailTransportFailed');
    return batch;
  };
  const send=async(kind:'packet'|'receipt'|'chunk',source:string,id:string,offset:number,wire:Uint8Array)=>{
    const h=inspectSecureHeader(wire);
    if(h.dataset_id!==datasetId || h.sender_id!==deviceId || h.kind!==kind || h.message_id!==id || h.offset!==(kind==='chunk'?offset:undefined) || source!==deviceId)
      throw new AppError('invalidSyncPacket');
    await native.send({...connection,kind,source,id,offset,payload:to64(wire)});
  };
  return {
    transport:{
      list:async kind=>(await fetch()).filter(m=>m.kind===kind).map(m=>from64(m.payload)),
      send:async(kind,wire)=>{
        const h=inspectSecureHeader(wire);
        await send(kind,deviceId,h.message_id,-1,wire);
      },
      attachments:{
        put:async(source,id,offset,wire)=>send('chunk',source,id,offset,wire),
        get:async(source,id,offset)=>{
          const item=(await fetch()).find(m=>m.kind==='chunk'&&m.source===source&&m.id===id&&m.offset===offset);
          if(!item)throw new AppError('fileMissing');
          return from64(item.payload);
        },
        exists:async(source,id,offset)=>(await fetch()).some(m=>m.kind==='chunk'&&m.source===source&&m.id===id&&m.offset===offset),
      },
    },
    commitCursor:()=>({...pending}),
    reset:()=>{batch=null;},
  };
}
