import {afterEach,describe,expect,it} from 'vitest';
import {adapters,fixture} from '../support/fixture';
import {exportDatabaseArchive,importDatabaseArchive} from '../../src/core/database-archive';
import {Repository} from '../../src/core/repository';
import {runLocalSyncCycle} from '../../src/core/local-sync-engine';
import {encryptedSyncMailbox,type OpaqueSyncTransport} from '../../src/core/encrypted-sync-mailbox';
import {importGroupKey} from '../../src/core/secure-sync-envelope';
import type {ArchiveWriter} from '../../src/core/archive-zip';

describe.each(adapters)('%s M6 encrypted independent SQLite replay',kind=>{
  const nodes:Awaited<ReturnType<typeof fixture>>[]=[];
  afterEach(async()=>{for(const n of nodes.splice(0))await n.cleanup();});
  it('requires authenticated delivery, retries and ACK; rejects tampering without cursor advance',async()=>{
    const left=await fixture(kind);nodes.push(left);
    const a=left.api!;
    const lib=await a.createLibrary('Encrypted shared');
    const collection=await a.createCollection(lib.id,'Notes','Text');
    const initial=await a.saveEntry(collection.id,{[collection.primary_field_id]:'Original'});
    await a.startLocalSync();
    const chunks:Uint8Array[]=[];
    const writer:ArchiveWriter={write:async bytes=>{chunks.push(Uint8Array.from(bytes));},
      finish:async()=>{},abort:async()=>{throw new Error('archive error');}};
    const manifest=await exportDatabaseArchive(left.db,left.files,writer);
    const archive=new Uint8Array(Buffer.concat(chunks));
    const right=await fixture(kind,false);nodes.push(right);
    await importDatabaseArchive({name:'snapshot.zip',mime:'application/zip',size:archive.length,
      read:async(offset,length)=>archive.slice(offset,offset+length)},right.db,right.files);
    const b=await Repository.open(right.db,right.files);
    await b.registerLocalArchiveBaseline(a.deviceId,manifest);
    await a.acknowledgeLocalArchiveBaseline(b.deviceId,manifest);
    await b.startLocalSync();
    const changed=await a.saveEntry(collection.id,{[collection.primary_field_id]:'After'},initial.id,initial.hlc);
    const packetBytes:Uint8Array[]=[],receiptBytes:Uint8Array[]=[];
    const transport:OpaqueSyncTransport={
      list:async kind=>kind==='packet'?packetBytes:receiptBytes,
      send:async(kind,bytes)=>{(kind==='packet'?packetBytes:receiptBytes).push(Uint8Array.from(bytes));},
    };
    const key=await importGroupKey(new Uint8Array(32));
    const am=encryptedSyncMailbox(transport,key,a.datasetId,a.deviceId);
    const bm=encryptedSyncMailbox(transport,key,b.datasetId,b.deviceId);
    const first=await runLocalSyncCycle(a,am,[b.deviceId],20);
    expect(first.sent).toBe(1);
    expect(Buffer.from(packetBytes[0]!).toString()).not.toContain('After');
    const tampered=Uint8Array.from(packetBytes[0]!);tampered[tampered.length-9]^=1;
    packetBytes.unshift(tampered);
    await expect(runLocalSyncCycle(b,bm,[a.deviceId],20)).rejects.toThrow('invalidSyncPacket');
    expect(await b.localSyncReceiveCursor(a.deviceId)).toBe(manifest.checkpoint.seq);
    packetBytes.shift();
    for(let n=0;n<6;n++){
      await runLocalSyncCycle(b,bm,[a.deviceId],20);
      await runLocalSyncCycle(a,am,[b.deviceId],20);
    }
    expect((await b.getEntry(initial.id))?.hlc).toBe(changed.hlc);
    expect((await b.getHistory(initial.id)).versions).toHaveLength(2);
    expect((await a.localSyncPeerAck(b.deviceId))!).toBeGreaterThan(0);
    expect((await b.localSyncReceiveCursor(a.deviceId))).toBeGreaterThan(manifest.checkpoint.seq);
  });
});
