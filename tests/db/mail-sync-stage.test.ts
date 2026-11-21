import {afterEach,describe,expect,it} from 'vitest';
import {adapters,fixture} from '../support/fixture';
import {importGroupKey,sealSyncBytes} from '../../src/core/secure-sync-envelope';
import {stageIncomingEmail} from '../../src/platform/mail-sync-stage';
import type {OpaqueSyncTransport} from '../../src/core/encrypted-sync-mailbox';
const peer='87654321-4321-4433-8433-123456789abc';
const attachment='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe.each(adapters)('%s M6 durable encrypted mail staging',kind=>{
  const nodes:Awaited<ReturnType<typeof fixture>>[]=[];
  afterEach(async()=>{for(const node of nodes.splice(0))await node.cleanup();});
  it('retains earlier encrypted chunks over cycle and repository re-open while refusing forged bytes',async()=>{
    const f=await fixture(kind);nodes.push(f);
    const api=f.api!;
    const key=await importGroupKey(crypto.getRandomValues(new Uint8Array(32)));
    const wire=await sealSyncBytes(key,{dataset_id:api.datasetId,sender_id:peer,
      kind:'chunk',message_id:attachment,offset:0},new Uint8Array([1,2,3,4]));
    const plainStore:OpaqueSyncTransport={
      list:async()=>[],
      send:async()=>{},
      attachments:{
        put:async()=>{},
        get:async()=>{throw Error('not on current IMAP page');},
        exists:async()=>false,
      },
    };
    const first=stageIncomingEmail(api,plainStore,async()=>[wire],key);
    expect(await first.transport.list('packet')).toEqual([]);
    await first.prune();
    const staged=await api.db.read(s=>s.query<{key:string}>(
      "SELECT key FROM local_settings WHERE key LIKE 'sync_mail:stage:%'"));
    expect(staged).toHaveLength(1);
    const second=stageIncomingEmail(api,plainStore,async()=>[],key);
    expect(await second.transport.attachments!.exists!(peer,attachment,0)).toBe(true);
    expect(await second.transport.attachments!.get(peer,attachment,0)).toEqual(wire);
    const malicious=Uint8Array.from(wire);malicious[malicious.length-4]=(malicious[malicious.length-4] ?? 0)^1;
    const bad=stageIncomingEmail(api,plainStore,async()=>[malicious],key);
    await expect(bad.transport.list('packet')).rejects.toThrow('invalidSyncPacket');
    expect((await api.db.read(s=>s.query<{key:string}>(
      "SELECT key FROM local_settings WHERE key LIKE 'sync_mail:stage:%'")))).toHaveLength(1);
  });
});
