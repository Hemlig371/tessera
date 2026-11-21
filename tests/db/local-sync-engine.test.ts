import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { adapters, fixture } from '../support/fixture';
import { exportDatabaseArchive, importDatabaseArchive } from '../../src/core/database-archive';
import { Repository } from '../../src/core/repository';
import { runLocalSyncCycle, type LocalSyncMailbox } from '../../src/core/local-sync-engine';
import { decodeLocalPacket } from '../../src/core/sync-protocol';
import type { ArchiveWriter } from '../../src/core/archive-zip';

describe.each(adapters)('%s M5 file-backed local transport cycle', kind => {
  const nodes: Awaited<ReturnType<typeof fixture>>[] = [];
  afterEach(async () => { for (const db of nodes.splice(0)) await db.cleanup(); });
  it('resumes after missing ACK and applies each event once despite reordered mailbox pages', async () => {
    const left = await fixture(kind); nodes.push(left);
    const a = left.api!;
    const library = await a.createLibrary('Transport'), collection = await a.createCollection(library.id,'Tasks','Title');
    const initial = await a.saveEntry(collection.id,{[collection.primary_field_id]:'Before'});
    await a.startLocalSync();
    const chunks:Uint8Array[] = [];
    const writer:ArchiveWriter = {write:async bytes=>{chunks.push(Uint8Array.from(bytes));},
      finish:async()=>{},abort:async()=>{throw new Error('archive failed');}};
    const manifest = await exportDatabaseArchive(left.db,left.files,writer);
    const zip = new Uint8Array(Buffer.concat(chunks));
    const right = await fixture(kind,false); nodes.push(right);
    await importDatabaseArchive({name:'archive.zip',mime:'application/zip',size:zip.length,
      read:async(offset,length)=>zip.slice(offset,offset+length)},right.db,right.files);
    const b = await Repository.open(right.db,right.files);
    await expect(b.registerLocalArchiveBaseline(a.deviceId,{ ...manifest,
      checkpoint: { ...manifest.checkpoint, seq: manifest.checkpoint.seq + 1 } })).rejects.toThrow('invalidArchive');
    await b.registerLocalArchiveBaseline(a.deviceId,manifest);
    await a.acknowledgeLocalArchiveBaseline(b.deviceId,manifest);
    await b.startLocalSync();
    const after = await a.saveEntry(collection.id,{[collection.primary_field_id]:'After'},initial.id,initial.hlc);
    const root = join(left.directory,'mailbox');
    await mkdir(join(root,'packets'),{recursive:true});
    await mkdir(join(root,'receipts'),{recursive:true});
    await mkdir(join(root,'chunks'),{recursive:true});
    const files = (kind:string) => join(root,kind);
    const chunkPath = (sourceId:string,attachmentId:string,offset:number) =>
      join(root,'chunks',sourceId+'-'+attachmentId+'-'+offset+'.bin');
    const mailbox:LocalSyncMailbox = {
      attachments: {
        async writeChunk(value) {
          expect(value.bytes.length).toBeLessThanOrEqual(256*1024);
          await writeFile(chunkPath(value.source_id,value.attachment_id,value.offset),value.bytes);
        },
        async readChunk(request) {
          return new Uint8Array(await readFile(chunkPath(request.source_id,request.attachment_id,request.offset)));
        },
        async hasFirstChunk(request) {
          try { return (await stat(chunkPath(request.source_id,request.attachment_id,0))).isFile(); }
          catch { return false; }
        },
      },
      async listPackets() {
        const names = (await readdir(files('packets'))).reverse();
        return Promise.all(names.map(async name=>new Uint8Array(await readFile(join(files('packets'),name)))));
      },
      async listReceipts() {
        const names = (await readdir(files('receipts'))).reverse();
        return Promise.all(names.map(async name=>new Uint8Array(await readFile(join(files('receipts'),name)))));
      },
      async publishPacket(payload) {
        const packet = decodeLocalPacket(payload);
        await writeFile(join(files('packets'),packet.sender_id + '-' + packet.after_seq + '.json'),payload);
      },
      async publishReceipt(payload) {
        const value = JSON.parse(new TextDecoder().decode(payload)) as {receiver_id:string;packet_id:string};
        await writeFile(join(files('receipts'),value.receiver_id+'-'+value.packet_id+'.json'),payload);
      },
    };
    const first = await runLocalSyncCycle(a,mailbox,[b.deviceId],3);
    expect(first.sent).toBe(1);
    const second = await runLocalSyncCycle(a,mailbox,[b.deviceId],3);
    expect(second.sent).toBe(1); // No receipt yet: resend, do not drop.
    for (let n=0;n<12;n++) {
      await runLocalSyncCycle(b,mailbox,[a.deviceId],3);
      await runLocalSyncCycle(a,mailbox,[b.deviceId],3);
    }
    expect((await b.getEntry(after.id))?.hlc).toBe(after.hlc);
    expect((await a.getEntry(after.id))?.hlc).toBe(after.hlc);
    expect((await b.getHistory(initial.id)).versions).toHaveLength(2);
    expect((await a.getHistory(initial.id)).versions).toHaveLength(2);
    expect((await a.localSyncPeerAck(b.deviceId))!).toBeGreaterThan(0);
    expect((await a.localSyncSafety()).last_success_at).not.toBeNull();
    expect((await b.localSyncPeerAck(a.deviceId))!).toBeGreaterThan(0);
    const quiet = await runLocalSyncCycle(a,mailbox,[b.deviceId],100);
    expect(quiet.gaps).toBe(0);
    const fileField = await a.createField(collection.id,'File attachment','file',{multiple:true});
    const current = await a.getEntry(initial.id);
    const data = new Uint8Array(320*1024).fill(41);
    const staged = await a.stageAttachment(collection.id,initial.id,{
      name:'automated.bin',mime:'application/octet-stream',size:data.length,
      read:async(offset,length)=>data.slice(offset,offset+length),
    });
    const changed = await a.saveEntry(collection.id,{[fileField.id]:[staged.id]},initial.id,current!.hlc);
    for (let n=0;n<20;n++) {
      await runLocalSyncCycle(a,mailbox,[b.deviceId],3);
      await runLocalSyncCycle(b,mailbox,[a.deviceId],3);
    }
    expect((await b.getEntry(changed.id))?.data[fileField.id]).toEqual([staged.id]);
    expect((await b.getAttachmentView(staged.id,initial.id,true)).status).toBe('present');
    expect((await b.getAttachmentView(staged.id,initial.id,true)).sha256).toBe(staged.sha256);

  });
});
