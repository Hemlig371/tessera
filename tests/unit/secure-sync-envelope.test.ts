import { describe, expect, it } from 'vitest';
import { buildLocalPacket, encodeLocalPacket } from '../../src/core/sync-protocol';
import { importGroupKey, openSyncBytes, sealSyncBytes } from '../../src/core/secure-sync-envelope';
import { encryptedSyncMailbox, type OpaqueSyncTransport } from '../../src/core/encrypted-sync-mailbox';
import type { JournalChange } from '../../src/core/change-journal';
const dataset='12345678-1234-4123-8123-123456789abc';
const sender='87654321-4321-4433-8433-123456789abc';
const receiver='99999999-9999-4999-8999-123456789abc';
const hlc='0000001730000000-0000000000-'+sender;
const change:JournalChange={seq:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',entity_type:'library',
  entity_id:dataset,hlc,device_id:sender,payload:JSON.stringify({id:dataset,hlc,device_id:sender,name:'Private title'})};
const packet = encodeLocalPacket(buildLocalPacket(dataset,sender,{dataset_id:dataset,seq:0},[change]));
describe('M6 AES-GCM authenticated transport',()=>{
  it('roundtrips without exposing data, randomizes nonce and rejects tampering',async()=>{
    const key=await importGroupKey(crypto.getRandomValues(new Uint8Array(32)));
    const h={dataset_id:dataset,sender_id:sender,kind:'packet' as const,message_id:change.id};
    const first=await sealSyncBytes(key,h,packet), second=await sealSyncBytes(key,h,packet);
    expect(new TextDecoder().decode(first)).not.toContain('Private title');
    expect(first).not.toEqual(second);
    expect((await openSyncBytes(key,first,{dataset_id:dataset,kind:'packet'})).bytes).toEqual(packet);
    const wire=JSON.parse(new TextDecoder().decode(first));
    for(const forged of [{...wire,sender_id:receiver},{...wire,ciphertext:wire.ciphertext.replace(/^./,wire.ciphertext[0]==='A'?'B':'A')},
      {...wire,nonce:'AAAA'},{...wire,dataset_id:receiver},{...wire,extra:true}]) {
      await expect(openSyncBytes(key,new TextEncoder().encode(JSON.stringify(forged)),{dataset_id:dataset})).rejects.toThrow('invalidSyncPacket');
    }
    const wrong=await importGroupKey(crypto.getRandomValues(new Uint8Array(32)));
    await expect(openSyncBytes(wrong,first,{dataset_id:dataset})).rejects.toThrow('invalidSyncPacket');
  });
  it('rejects forged decrypted packet identities and invalid key sizes',async()=>{
    await expect(importGroupKey(new Uint8Array(16))).rejects.toThrow('invalidSyncPacket');
    const key=await importGroupKey(new Uint8Array(32));
    await expect(sealSyncBytes(key,{dataset_id:dataset,sender_id:receiver,kind:'packet',message_id:change.id},packet))
      .rejects.toThrow('invalidSyncPacket');
  });
  it('encrypts packets, receipts and attachment chunks before opaque transport',async()=>{
    const key=await importGroupKey(new Uint8Array(32));
    const packets:Uint8Array[]=[],receipts:Uint8Array[]=[];
    const chunks=new Map<string,Uint8Array>();
    const transport:OpaqueSyncTransport={
      list:async kind=>kind==='packet'?packets:receipts,
      send:async(kind,bytes)=>{(kind==='packet'?packets:receipts).push(bytes);},
      attachments:{
        put:async(source,id,offset,bytes)=>{chunks.set(source+':'+id+':'+offset,bytes);},
        get:async(source,id,offset)=>chunks.get(source+':'+id+':'+offset)!,
        exists:async(source,id,offset)=>chunks.has(source+':'+id+':'+offset),
      },
    };
    const a=encryptedSyncMailbox(transport,key,dataset,sender);
    const b=encryptedSyncMailbox(transport,key,dataset,receiver);
    await a.publishPacket(packet);
    expect(packets[0]).not.toEqual(packet);
    expect(await b.listPackets()).toEqual([packet]);
    const receipt=new TextEncoder().encode(JSON.stringify({format:'tessera-local-receipt',version:1,
      packet_id:change.id,dataset_id:dataset,sender_id:sender,receiver_id:receiver,through_seq:1}));
    await b.publishReceipt(receipt);
    expect(receipts[0]).not.toEqual(receipt);
    expect(await a.listReceipts()).toEqual([receipt]);
    const chunk=new Uint8Array(512).fill(37);
    await a.attachments!.writeChunk({dataset_id:dataset,source_id:sender,attachment_id:change.id,offset:0,bytes:chunk});
    expect(chunks.get(sender+':'+change.id+':0')).not.toEqual(chunk);
    expect(await b.attachments!.readChunk({dataset_id:dataset,source_id:sender,attachment_id:change.id,offset:0,length:512})).toEqual(chunk);
    await a.attachments!.writeChunk({dataset_id:dataset,source_id:sender,attachment_id:change.id,offset:512,bytes:new Uint8Array(0)});
    expect(chunks.get(sender+':'+change.id+':512')?.length).toBeGreaterThan(0);
    await expect(b.attachments!.readChunk({dataset_id:dataset,source_id:receiver,attachment_id:change.id,offset:0,length:512}))
      .rejects.toThrow('invalidSyncPacket');
  });
});
