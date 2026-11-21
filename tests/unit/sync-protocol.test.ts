import { describe, expect, it } from 'vitest';
import { buildLocalPacket, decodeLocalPacket, encodeLocalPacket, parseLocalPacket, parseLocalReceipt } from '../../src/core/sync-protocol';
import type { JournalChange } from '../../src/core/change-journal';
const a = '12345678-1234-4123-8123-123456789abc';
const b = '87654321-4321-4433-8433-123456789abc';
const hlc = '0000001730000000-0000000000-' + a;
const row: JournalChange = { seq: 1, id: b, entity_type: 'library', entity_id: a,
  hlc, device_id: a, payload: JSON.stringify({ id: a, hlc, device_id: a, name: 'Test' }) };
describe('M5 local protocol envelope', () => {
  it('encodes a deterministic bounded UTF-8 packet and strict typed receipt', () => {
    const packet = buildLocalPacket(a,b,{dataset_id:a,seq:0},[row]);
    expect(decodeLocalPacket(encodeLocalPacket(packet))).toEqual(packet);
    expect(parseLocalReceipt({format:'tessera-local-receipt', version:1,packet_id:b,dataset_id:a,sender_id:b,receiver_id:a,through_seq:1}).receiver_id).toBe(a);
  });
  it('rejects holes, reordered or duplicated events, wrong clock owners and dataset', () => {
    const packet = buildLocalPacket(a,b,{dataset_id:a,seq:0},[row]);
    for (const invalid of [
      {...packet, through_seq:3}, {...packet, events:[{...packet.events[0],seq:2}]},
      {...packet, events:[packet.events[0],packet.events[0]],through_seq:2},
      {...packet, dataset_id:'wrong'}, {...packet, events:[{...packet.events[0], device_id:b}]},
      {...packet, events:[{...packet.events[0],entity_type:'unknown'}]},
    ]) expect(() => parseLocalPacket(invalid)).toThrow('invalidSyncPacket');
    expect(() => decodeLocalPacket(new Uint8Array([255]))).toThrow('invalidSyncPacket');
  });
  it('rejects an ACK claiming the wrong identity or field shape', () => {
    expect(() => parseLocalReceipt({ format:'tessera-local-receipt',version:1,dataset_id:a,sender_id:a,receiver_id:a,through_seq:1 })).toThrow();
    expect(() => parseLocalReceipt({ format:'tessera-local-receipt',version:1,dataset_id:a,sender_id:b,receiver_id:a,through_seq:-1 })).toThrow();
  });
});
