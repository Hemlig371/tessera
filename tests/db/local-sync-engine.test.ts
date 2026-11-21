import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
    await b.registerLocalArchiveBaseline(a.deviceId,manifest);
    await a.acknowledgeLocalArchiveBaseline(b.deviceId,manifest);
    await b.startLocalSync();
    const after = await a.saveEntry(collection.id,{[collection.primary_field_id]:'After'},initial.id,initial.hlc);
    const root = join(left.directory,'mailbox');
    await mkdir(join(root,'packets'),{recursive:true});
    await mkdir(join(root,'receipts'),{recursive:true});
    const files = (kind:string) => join(root,kind);
    const mailbox:LocalSyncMailbox = {
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
    expect((await b.localSyncPeerAck(a.deviceId))!).toBeGreaterThan(0);
    const quiet = await runLocalSyncCycle(a,mailbox,[b.deviceId],100);
    expect(quiet.gaps).toBe(0);
  });
});
