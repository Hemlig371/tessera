import {afterEach,describe,expect,it} from 'vitest';
import {adapters,fixture} from '../support/fixture';
import {exportDatabaseArchive,importDatabaseArchive} from '../../src/core/database-archive';
import {Repository} from '../../src/core/repository';
import {runLocalSyncCycle} from '../../src/core/local-sync-engine';
import {encryptedSyncMailbox,type OpaqueSyncTransport} from '../../src/core/encrypted-sync-mailbox';
import {importGroupKey} from '../../src/core/secure-sync-envelope';
import type {ArchiveWriter} from '../../src/core/archive-zip';

describe.each(adapters)('%s M6 encrypted attachment transfer on independent SQLite',kind=>{
  const nodes:Awaited<ReturnType<typeof fixture>>[]=[];
  afterEach(async()=>{for(const n of nodes.splice(0))await n.cleanup();});
  it('restores 320 KiB over authenticated 256 KiB chunks and converges after a damaged mail retry',async()=>{
    const left=await fixture(kind);nodes.push(left);
    const a=left.api!;
    const lib=await a.createLibrary('Files');
    const col=await a.createCollection(lib.id,'Documents','Title');
    const initial=await a.saveEntry(col.id,{[col.primary_field_id]:'Before'});
    await a.startLocalSync();
    const parts:Uint8Array[]=[];
    const writer:ArchiveWriter={write:async value=>{parts.push(Uint8Array.from(value));},
      finish:async()=>{},abort:async()=>{throw Error('zip failed');}};
    const manifest=await exportDatabaseArchive(left.db,left.files,writer);
    const zipped=new Uint8Array(Buffer.concat(parts));
    const right=await fixture(kind,false);nodes.push(right);
    await importDatabaseArchive({name:'archive.zip',mime:'application/zip',size:zipped.length,
      read:async(o,n)=>zipped.slice(o,o+n)},right.db,right.files);
    const b=await Repository.open(right.db,right.files);
    await b.registerLocalArchiveBaseline(a.deviceId,manifest);
    await a.acknowledgeLocalArchiveBaseline(b.deviceId,manifest);
    await b.startLocalSync();
    const field=await a.createField(col.id,'Attachment','file',{multiple:true});
    const data=new Uint8Array(320*1024).fill(89);
    const attached=await a.stageAttachment(col.id,initial.id,{
      name:'private.bin',mime:'application/octet-stream',size:data.length,
      read:async(o,n)=>data.slice(o,o+n),
    });
    const updated=await a.saveEntry(col.id,{[field.id]:[attached.id]},initial.id,initial.hlc);
    const packets:Uint8Array[]=[], receipts:Uint8Array[]=[];
    const cache=new Map<string,Uint8Array>();
    const chunkKey=(source:string,id:string,offset:number)=>source+':'+id+':'+offset;
    const transport:OpaqueSyncTransport={
      list:async kind=>kind==='packet'?packets:receipts,
      send:async(kind,bytes)=>{(kind==='packet'?packets:receipts).push(Uint8Array.from(bytes));},
      attachments:{
        put:async(source,id,offset,wire)=>{cache.set(chunkKey(source,id,offset),Uint8Array.from(wire));},
        get:async(source,id,offset)=>{
          const wire=cache.get(chunkKey(source,id,offset));
          if(!wire)throw Error('fileMissing');
          return wire;
        },
        exists:async(source,id,offset)=>cache.has(chunkKey(source,id,offset)),
      },
    };
    const key=await importGroupKey(crypto.getRandomValues(new Uint8Array(32)));
    const am=encryptedSyncMailbox(transport,key,a.datasetId,a.deviceId);
    const bm=encryptedSyncMailbox(transport,key,b.datasetId,b.deviceId);
    await runLocalSyncCycle(a,am,[b.deviceId],50);
    const name=chunkKey(a.deviceId,attached.id,0);
    const original=Uint8Array.from(cache.get(name)!);
    expect(original.length).toBeGreaterThan(data.length/2);
    const corrupted=Uint8Array.from(original);corrupted[corrupted.length-8]=(corrupted[corrupted.length-8] ?? 0)^1;
    cache.set(name,corrupted);
    await expect(runLocalSyncCycle(b,bm,[a.deviceId],50)).rejects.toThrow('invalidSyncPacket');
    expect((await b.getAttachmentView(attached.id,initial.id,true)).status).toBe('missing');
    cache.set(name,original);
    for(let n=0;n<12;n++){
      await runLocalSyncCycle(b,bm,[a.deviceId],50);
      await runLocalSyncCycle(a,am,[b.deviceId],50);
    }
    expect((await b.getAttachmentView(attached.id,initial.id,true)).status).toBe('present');
    expect((await b.getEntry(updated.id))?.data[field.id]).toEqual([attached.id]);
    expect((await b.getAttachmentView(attached.id,initial.id,true)).sha256).toBe(attached.sha256);
  });
});
