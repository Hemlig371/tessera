import { AppError } from './errors';
import { assertHlc } from './hlc';
import { canonical, UUID_RE, type JsonValue } from './model';
import type { JournalChange, JournalCheckpoint } from './change-journal';

export const localProtocolVersion = 1;
export type SyncEntity = 'library' | 'collection' | 'field' | 'record' | 'record_version' |
  'ui_config' | 'quick_form' | 'display_profile' | 'creation_preset' |
  'attachment' | 'attachment_location' | 'history_marker' | 'history_clear' | 'app_setting';

export interface SyncEvent {
  seq: number;
  id: string;
  entity_type: SyncEntity;
  entity_id: string;
  hlc: string;
  device_id: string;
  payload: Record<string, JsonValue>;
}
export interface LocalSyncPacket {
  format: 'tessera-local-sync';
  version: 1;
  packet_id: string;
  dataset_id: string;
  sender_id: string;
  after_seq: number;
  through_seq: number;
  events: SyncEvent[];
}
export interface SyncReceipt {
  format: 'tessera-local-receipt';
  version: 1;
  packet_id: string;
  dataset_id: string;
  sender_id: string;
  receiver_id: string;
  through_seq: number;
}
const kinds = new Set<SyncEntity>([
  'library', 'collection', 'field', 'record', 'record_version', 'ui_config',
  'quick_form', 'display_profile', 'creation_preset', 'attachment',
  'attachment_location', 'history_marker', 'history_clear', 'app_setting',
]);
const fail = (): never => { throw new AppError('invalidSyncPacket'); };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const number = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 65536;
/** Packet validation is performed before any transaction or side effect. */
export function parseLocalPacket(input: unknown): LocalSyncPacket {
  if (!object(input) || input.format !== 'tessera-local-sync' || input.version !== 1 ||
      !id(input.packet_id) || !id(input.dataset_id) || !id(input.sender_id) || !number(input.after_seq) ||
      !number(input.through_seq) || !Array.isArray(input.events) ||
      input.events.length < 1 || input.events.length > 200 ||
      input.through_seq !== input.after_seq + input.events.length || input.packet_id !== input.events[0]?.id ||
      Object.keys(input).some(key => !['format', 'version', 'packet_id', 'dataset_id', 'sender_id', 'after_seq', 'through_seq', 'events'].includes(key))) fail();
  const packet = input as unknown as LocalSyncPacket;
  const seen = new Set<string>();
  for (let n = 0; n < packet.events.length; n++) {
    const event = packet.events[n]!;
    if (!object(event) || event.seq !== packet.after_seq + n + 1 ||
        !id(event.id) || seen.has(event.id) || !kinds.has(event.entity_type) ||
        !text(event.entity_id) || !id(event.device_id) || typeof event.hlc !== 'string' ||
        !object(event.payload) || Object.keys(event).some(key =>
          !['seq','id','entity_type','entity_id','hlc','device_id','payload'].includes(key))) fail();
    seen.add(event.id);
    try {
      assertHlc(event.hlc);
      if (!event.hlc.endsWith('-' + event.device_id.toLowerCase())) fail();
      if (['app_setting', 'history_marker'].includes(event.entity_type)) {
        if (event.entity_id.length < 4 || event.payload.key !== event.entity_id ||
            typeof event.payload.value !== 'string') fail();
      } else if (event.entity_type === 'history_clear') {
        const recordId = event.payload.record_id;
        if (!(recordId === null || (typeof recordId === 'string' && id(recordId) &&
              recordId === event.entity_id)) ||
            event.payload.hlc !== event.hlc ||
            Object.keys(event.payload).some(key => key !== 'record_id' && key !== 'hlc')) fail();
      } else if (event.payload.id !== event.entity_id ||
        event.payload.hlc !== event.hlc || event.payload.device_id !== event.device_id) fail();
      if (canonical(event.payload) !== canonical(JSON.parse(JSON.stringify(event.payload)) as Record<string, JsonValue>)) fail();
    } catch { fail(); }
  }
  return packet;
}
export function buildLocalPacket(datasetId: string, senderId: string, after: JournalCheckpoint, changes: readonly JournalChange[]): LocalSyncPacket {
  if (!id(datasetId) || !id(senderId) || after.dataset_id !== datasetId ||
      !number(after.seq) || changes.length < 1 || changes.length > 200) fail();
  const events = changes.map(row => ({
    seq: row.seq, id: row.id, entity_type: row.entity_type as SyncEntity,
    entity_id: row.entity_id, hlc: row.hlc, device_id: row.device_id,
    payload: JSON.parse(row.payload) as Record<string, JsonValue>,
  }));
  return parseLocalPacket({ format: 'tessera-local-sync', version: 1, packet_id: events[0]!.id, dataset_id: datasetId,
    sender_id: senderId, after_seq: after.seq, through_seq: events.at(-1)!.seq, events });
}
export function parseLocalReceipt(input: unknown): SyncReceipt {
  if (!object(input) || input.format !== 'tessera-local-receipt' || input.version !== 1 ||
      !id(input.packet_id) || !id(input.dataset_id) || !id(input.sender_id) || !id(input.receiver_id) ||
      input.sender_id === input.receiver_id || !number(input.through_seq) ||
      Object.keys(input).some(key => !['format','version','packet_id','dataset_id','sender_id','receiver_id','through_seq'].includes(key))) fail();
  return input as unknown as SyncReceipt;
}
export function encodeLocalPacket(packet: LocalSyncPacket): Uint8Array {
  const valid = parseLocalPacket(packet);
  const bytes = new TextEncoder().encode(canonical(valid as unknown as JsonValue));
  if (bytes.length > 8 * 1024 * 1024) fail();
  return bytes;
}
export function decodeLocalPacket(bytes: Uint8Array): LocalSyncPacket {
  if (!(bytes instanceof Uint8Array) || bytes.length > 8 * 1024 * 1024 || bytes.length === 0) fail();
  try { return parseLocalPacket(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown); }
  catch { return fail(); }
}
