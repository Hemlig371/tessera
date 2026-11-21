import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adapters, fixture } from '../support/fixture';
import { exportDatabaseArchive, importDatabaseArchive } from '../../src/core/database-archive';
import type { ArchiveWriter } from '../../src/core/archive-zip';
import { Repository } from '../../src/core/repository';
import { decodeLocalPacket, encodeLocalPacket, type LocalSyncPacket } from '../../src/core/sync-protocol';
import type { JournalCheckpoint } from '../../src/core/change-journal';

describe.each(adapters)('%s M5 independent SQLite replication over local files', kind => {
  const opened: Awaited<ReturnType<typeof fixture>>[] = [];
  afterEach(async () => { for (const db of opened.splice(0)) await db.cleanup(); });
  async function nodes() {
    const left = await fixture(kind); opened.push(left);
    const a = left.api!;
    const library = await a.createLibrary('Shared'), collection = await a.createCollection(library.id, 'Tasks','Title');
    const file = await a.createField(collection.id,'Files','file',{ multiple:true });
    const entry = await a.saveEntry(collection.id, { [collection.primary_field_id]: 'Before archive' });
    await a.startLocalSync();
    const chunks: Uint8Array[] = [];
    const writer: ArchiveWriter = {
      write: async data => { chunks.push(Uint8Array.from(data)); }, finish: async () => {},
      abort: async () => { throw new Error('unexpected abort'); },
    };
    await exportDatabaseArchive(left.db,left.files,writer);
    const bytes = Uint8Array.from(Buffer.concat(chunks));
    const right = await fixture(kind,false); opened.push(right);
    await importDatabaseArchive({
      name: 'baseline.zip', mime: 'application/zip', size: bytes.length,
      read: async (offset,length) => bytes.slice(offset,offset+length),
    },right.db,right.files);
    const b = await Repository.open(right.db,right.files);
    expect(b.datasetId).toBe(a.datasetId);
    expect(b.deviceId).not.toBe(a.deviceId);
    await b.startLocalSync();
    return { left, right, a,b,library,collection,entry,file };
  }
  const zero = (api: Repository): JournalCheckpoint => ({ dataset_id: api.datasetId,seq:0 });
  async function deliver(sender: Repository,receiver: Repository,after: JournalCheckpoint,folder: string,limit = 20) {
    let checkpoint = after;
    for (let page = 0; page < 500; page++) {
      const outgoing = await sender.exportLocalSyncPacket(checkpoint,limit);
      if (!outgoing) return checkpoint;
      const path = join(folder,'packet-' + page + '.json');
      await writeFile(path,encodeLocalPacket(outgoing));
      const received = decodeLocalPacket(new Uint8Array(await readFile(path)));
      const receipt = await receiver.applyLocalSyncPacket(received);
      await sender.acceptLocalSyncReceipt(receipt);
      checkpoint = { dataset_id:sender.datasetId,seq:received.through_seq };
    }
    throw new Error('unbounded replication');
  }
  it('applies baseline and delta with ACK only after SQLite commit, then converges both ways without duplicate history', async () => {
    const { left, a,b,collection,entry } = await nodes();
    let sent = await deliver(a,b,zero(a),left.directory,5);
    expect(await b.getEntry(entry.id)).toEqual(await a.getEntry(entry.id));
    const edited = await a.saveEntry(collection.id,{ [collection.primary_field_id]:'After archive' },entry.id,entry.hlc);
    sent = await deliver(a,b,sent,left.directory,5);
    expect((await b.getEntry(entry.id))?.hlc).toBe(edited.hlc);
    expect((await b.getEntry(entry.id))?.data[collection.primary_field_id]).toBe('After archive');
    const old = await b.getEntry(entry.id);
    const next = await b.saveEntry(collection.id,{ [collection.primary_field_id]:'Edited on B' },old!.id,old!.hlc);
    await deliver(b,a,zero(b),left.directory,5);
    expect((await a.getEntry(entry.id))?.hlc).toBe(next.hlc);
    expect((await a.getEntry(entry.id))?.data).toEqual((await b.getEntry(entry.id))?.data);
    expect((await a.getHistory(entry.id)).versions).toHaveLength(3);
    expect((await b.getHistory(entry.id)).versions).toHaveLength(3);
    await deliver(a,b,sent,left.directory,5); // The third edit is relayed once, not endlessly echoed.
    expect((await b.getHistory(entry.id)).versions).toHaveLength(3);
  });
  it('creates a record before its attachment metadata, transfers verified small chunks, and never transfers large bytes', async () => {
    const { a,b,left,collection,file } = await nodes();
    const baseline = await deliver(a,b,zero(a),left.directory,20);
    await a.saveAttachmentLimit(800 * 1024);
    const owner = crypto.randomUUID();
    const data = new Uint8Array(600 * 1024).fill(73);
    const staged = await a.stageAttachment(collection.id,owner, {
      name:'small.bin',mime:'application/octet-stream',size:data.length,
      read:async (offset,length) => data.slice(offset,offset+length),
    });
    await a.saveNewEntry(collection.id,{[collection.primary_field_id]:'With file',[file.id]:[staged.id]},owner);
    await deliver(a,b,baseline,left.directory,15);
    expect((await b.getEntry(owner))?.data[file.id]).toEqual([staged.id]);
    expect((await b.getAttachmentView(staged.id,owner)).status).toBe('missing');
    const remoteFile = join(left.directory,'small-share.bin');
    await writeFile(remoteFile,Buffer.alloc(0));
    const segments: Uint8Array[] = [];
    for (let offset = 0; offset < data.length;offset+=256*1024) {
      const count = Math.min(256*1024,data.length-offset);
      segments.push(await a.readLocalSyncAttachmentChunk(staged.id,owner,offset,count));
    }
    await writeFile(remoteFile,Buffer.concat(segments));
    const shared = new Uint8Array(await readFile(remoteFile));
    await b.restoreAttachmentCopy(staged.id,owner,{
      name:'small.bin',mime:'application/octet-stream',size:shared.length,
      read:async (offset,length)=>shared.slice(offset,offset+length),
    });
    expect((await b.getAttachmentView(staged.id,owner,true)).status).toBe('present');
    expect(await b.readLocalSyncAttachmentChunk(staged.id,owner,0,10)).toEqual(data.slice(0,10));
    await expect(a.readLocalSyncAttachmentChunk(staged.id,owner,data.length-2,10)).rejects.toThrow('invalidFileOffset');
    const bigOwner = crypto.randomUUID(), big = new Uint8Array(900*1024).fill(7);
    const bigStage = await a.stageAttachment(collection.id,bigOwner,{
      name:'large.bin',mime:'application/octet-stream',size:big.length,
      read:async (offset,length)=>big.slice(offset,offset+length),
    });
    await a.saveNewEntry(collection.id,{[collection.primary_field_id]:'Large file',[file.id]:[bigStage.id]},bigOwner);
    await expect(a.readLocalSyncAttachmentChunk(bigStage.id,bigOwner,0,1)).rejects.toThrow('fileAboveSyncLimit');
  });
  it('rejects a missing page, wrong dataset and malicious replay without changing cursor or records', async () => {
    const { a,b,entry } = await nodes();
    const first = (await a.exportLocalSyncPacket(zero(a),1))!;
    const second = (await a.exportLocalSyncPacket({dataset_id:a.datasetId,seq:first.through_seq},1))!;
    const before = await b.getEntry(entry.id);
    await expect(b.applyLocalSyncPacket(second)).rejects.toThrow('journalGap');
    expect(await b.localSyncReceiveCursor(a.deviceId)).toBe(0);
    await expect(b.applyLocalSyncPacket({...first,dataset_id:crypto.randomUUID()})).rejects.toThrow('datasetMismatch');
    const receipt = await b.applyLocalSyncPacket(first);
    expect(receipt.through_seq).toBe(first.through_seq);
    expect(await b.applyLocalSyncPacket(first)).toEqual(receipt);
    expect(await b.getEntry(entry.id)).toEqual(before);
    await expect(a.acceptLocalSyncReceipt({...receipt, sender_id:crypto.randomUUID()})).rejects.toThrow('invalidSyncPacket');
    await a.acceptLocalSyncReceipt(receipt);
  });
  it('rolls back the whole incoming page on SQLite failure, retries, and preserves pause/detach semantics', async () => {
    const { a,b,right,entry } = await nodes();
    const packet: LocalSyncPacket = (await a.exportLocalSyncPacket(zero(a),200))!;
    await right.db.transaction(s => s.execute("CREATE TRIGGER fail_replay BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'injected replay failure'); END"));
    const modified = await a.saveEntry(entry.collection_id,{ [Object.keys(entry.data)[0]!]: 'trigger update' },entry.id,entry.hlc);
    const delta = (await a.exportLocalSyncPacket({dataset_id:a.datasetId,seq:packet.through_seq},200))!;
    await expect(b.applyLocalSyncPacket(delta)).rejects.toThrow('journalGap');
    await b.applyLocalSyncPacket(packet);
    const prior = await b.getEntry(entry.id);
    await expect(b.applyLocalSyncPacket(delta)).rejects.toThrow('injected replay failure');
    expect(await b.getEntry(entry.id)).toEqual(prior);
    expect(await b.localSyncReceiveCursor(a.deviceId)).toBe(packet.through_seq);
    await right.db.transaction(s => s.execute('DROP TRIGGER fail_replay'));
    await b.applyLocalSyncPacket(delta);
    expect((await b.getEntry(entry.id))?.hlc).toBe(modified.hlc);
    await b.pauseLocalSync(true);
    await expect(b.applyLocalSyncPacket(delta)).rejects.toThrow('invalidSyncState');
    await b.pauseLocalSync(false);
    await b.detachLocalSync();
    expect(await b.localSyncReceiveCursor(a.deviceId)).toBe(0);
    await expect(b.applyLocalSyncPacket(delta)).rejects.toThrow('datasetMismatch');
  });
});
