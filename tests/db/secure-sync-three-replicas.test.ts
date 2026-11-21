import {afterEach,describe,expect,it} from 'vitest';
import {adapters,fixture} from '../support/fixture';
import {exportDatabaseArchive,importDatabaseArchive} from '../../src/core/database-archive';
import {Repository} from '../../src/core/repository';
import {runLocalSyncCycle} from '../../src/core/local-sync-engine';
import {encryptedSyncMailbox,type OpaqueSyncTransport} from '../../src/core/encrypted-sync-mailbox';
import {importGroupKey} from '../../src/core/secure-sync-envelope';
import type {ArchiveWriter} from '../../src/core/archive-zip';

describe.each(adapters)('%s M6 three encrypted SQLite replicas after offline partition',kind=>{
  const nodes:Awaited<ReturnType<typeof fixture>>[]=[];
  afterEach(async()=>{for(const item of nodes.splice(0))await item.cleanup();});
  it('converges LWW, Top-20 and authenticated ACK after disconnected concurrent saves',async()=>{
    const first=await fixture(kind);nodes.push(first);
    const a=first.api!;
    const lib=await a.createLibrary('Replicas'),col=await a.createCollection(lib.id,'Records','Text');
    const entry=await a.saveEntry(col.id,{[col.primary_field_id]:'baseline'});
    await a.startLocalSync();
    const parts:Uint8Array[]=[];
    const writer:ArchiveWriter={write:async bytes=>{parts.push(Uint8Array.from(bytes));},
      finish:async()=>{},abort:async()=>{throw Error('zip aborted');}};
    const manifest=await exportDatabaseArchive(first.db,first.files,writer);
    const archive=new Uint8Array(Buffer.concat(parts));
    const add=async()=>{
      const node=await fixture(kind,false);nodes.push(node);
      await importDatabaseArchive({name:'baseline.zip',mime:'application/zip',size:archive.length,
        read:async(offset,length)=>archive.slice(offset,offset+length)},node.db,node.files);
      const api=await Repository.open(node.db,node.files);
      await api.registerLocalArchiveBaseline(a.deviceId,manifest);
      await a.acknowledgeLocalArchiveBaseline(api.deviceId,manifest);
      await api.startLocalSync();
      return api;
    };
    const b=await add(),c=await add();
    const key=await importGroupKey(crypto.getRandomValues(new Uint8Array(32)));
    const packets:Uint8Array[]=[],receipts:Uint8Array[]=[];
    const transport:OpaqueSyncTransport={
      list:async kind=>kind==='packet'?packets:receipts,
      send:async(kind,wire)=>{(kind==='packet'?packets:receipts).push(Uint8Array.from(wire));},
    };
    const ma=encryptedSyncMailbox(transport,key,a.datasetId,a.deviceId);
    const mb=encryptedSyncMailbox(transport,key,b.datasetId,b.deviceId);
    const mc=encryptedSyncMailbox(transport,key,c.datasetId,c.deviceId);
    const baselineSeq=manifest.checkpoint.seq;
    expect(await b.localSyncReceiveCursor(a.deviceId)).toBe(baselineSeq);
    expect(await c.localSyncReceiveCursor(a.deviceId)).toBe(baselineSeq);
    // Both devices save without seeing the other. The third is completely offline.
    const eb=await b.getEntry(entry.id),ec=await c.getEntry(entry.id);
    await b.saveEntry(col.id,{[col.primary_field_id]:'B private change'},entry.id,eb!.hlc);
    await c.saveEntry(col.id,{[col.primary_field_id]:'C private change'},entry.id,ec!.hlc);
    for(let i=0;i<6;i++){
      await runLocalSyncCycle(b,mb,[a.deviceId,c.deviceId],8);
      await runLocalSyncCycle(a,ma,[b.deviceId,c.deviceId],8);
    }
    // C returns late, receives old and current states; no data may be lost.
    for(let i=0;i<24;i++){
      await runLocalSyncCycle(c,mc,[a.deviceId,b.deviceId],8);
      await runLocalSyncCycle(b,mb,[a.deviceId,c.deviceId],8);
      await runLocalSyncCycle(a,ma,[b.deviceId,c.deviceId],8);
    }
    const records=await Promise.all([a,b,c].map(device=>device.getEntry(entry.id)));
    expect(records.every(record=>record?.hlc===records[0]?.hlc)).toBe(true);
    expect(['B private change','C private change']).toContain(records[0]?.data[col.primary_field_id]);
    const versions=await Promise.all([a,b,c].map(device=>device.getHistory(entry.id)));
    const identities=versions.map(v=>v.versions.map(x=>x.id).sort());
    expect(identities[0]).toHaveLength(3);
    expect(identities[1]).toEqual(identities[0]);
    expect(identities[2]).toEqual(identities[0]);
    expect(await a.localSyncPeerAck(b.deviceId)).not.toBeNull();
    expect(await a.localSyncPeerAck(c.deviceId)).not.toBeNull();
    expect(await b.localSyncReceiveCursor(c.deviceId)).toBeGreaterThan(0);
  });
});
