import { AppError } from './errors';
import { decodeLocalPacket, encodeLocalPacket, parseLocalReceipt, type SyncReceipt } from './sync-protocol';
import { canonical, UUID_RE, type JsonValue } from './model';
import type { Repository } from './repository';
import { journalCheckpoint } from './change-journal';
import { publishLocalAttachment, restoreLocalAttachment, type LocalAttachmentMailbox } from './local-sync-attachments';

/** Unencrypted local-test mailbox: encryption/authentication of opaque transport bytes is M6. */
export interface LocalSyncMailbox {
  listPackets(): Promise<readonly Uint8Array[]>;
  listReceipts(): Promise<readonly Uint8Array[]>;
  publishPacket(packet: Uint8Array): Promise<void>;
  publishReceipt(receipt: Uint8Array): Promise<void>;
  /** Optional file-byte channel; core never transports originals beyond the shared limit. */
  attachments?: LocalAttachmentMailbox;
}
export interface LocalSyncCycleResult {
  applied: number;
  duplicate: number;
  gaps: number;
  sent: number;
  acknowledgements: number;
}
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal:true });
function receiptBytes(receipt: SyncReceipt): Uint8Array {
  return encoder.encode(canonical(receipt as unknown as JsonValue));
}
/** Poll a local mailbox. Retains gaps for later cycles; no cursor advances on failed work. */
export async function runLocalSyncCycle(
  api: Repository, mailbox: LocalSyncMailbox, peers: readonly string[], limit = 100, maxPacketBytes = 8 * 1024 * 1024
): Promise<LocalSyncCycleResult> {
  if ((await api.localSyncSafety()).mode !== 'active') throw new AppError('invalidSyncState');
  if (!Number.isSafeInteger(maxPacketBytes) || maxPacketBytes < 1024 || maxPacketBytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      peers.length < 1 || peers.length > 32 || new Set(peers).size !== peers.length ||
      peers.some(id => !UUID_RE.test(id) || id === api.deviceId)) throw new AppError('invalidSyncPacket');
  const result: LocalSyncCycleResult = { applied:0, duplicate:0, gaps:0, sent:0, acknowledgements:0 };
  const packets = await mailbox.listPackets();
  if (packets.length > 2048) throw new AppError('invalidLimit');
  const pending = packets.map(decodeLocalPacket)
    .filter(packet => packet.dataset_id === api.datasetId && packet.sender_id !== api.deviceId &&
      peers.includes(packet.sender_id))
    .sort((a,b) => a.sender_id.localeCompare(b.sender_id) || a.after_seq-b.after_seq ||
      a.through_seq-b.through_seq || a.packet_id.localeCompare(b.packet_id));
  for (const packet of pending) {
    const cursor = await api.localSyncReceiveCursor(packet.sender_id);
    if (packet.through_seq > cursor && packet.after_seq !== cursor) { result.gaps++; continue; }
    const receipt = await api.applyLocalSyncPacket(packet);
    if (packet.through_seq <= cursor) result.duplicate++; else result.applied++;
    if (mailbox.attachments) {
      for (const event of packet.events) {
        if (event.entity_type !== 'attachment' || event.payload.purged !== 0 ||
            typeof event.payload.record_id !== 'string') continue;
        const id = event.entity_id, ownerId = event.payload.record_id;
        const view = await api.getAttachmentView(id,ownerId);
        if (view.large || view.status !== 'missing') continue;
        const offered = mailbox.attachments.hasFirstChunk
          ? await mailbox.attachments.hasFirstChunk({ dataset_id:api.datasetId,source_id:packet.sender_id,attachment_id:id })
          : true;
        if (offered) await restoreLocalAttachment(api,ownerId,id,packet.sender_id,mailbox.attachments);
      }
    }
    await mailbox.publishReceipt(receiptBytes(receipt));
  }
  const receipts = await mailbox.listReceipts();
  if (receipts.length > 2048) throw new AppError('invalidLimit');
  const parsedReceipts: SyncReceipt[] = receipts.map(raw => {
    try { return parseLocalReceipt(JSON.parse(decoder.decode(raw)) as unknown); }
    catch { throw new AppError('invalidSyncPacket'); }
  }).filter(receipt => receipt.dataset_id === api.datasetId &&
    receipt.sender_id === api.deviceId && peers.includes(receipt.receiver_id))
    .sort((a,b) => a.receiver_id.localeCompare(b.receiver_id) || a.through_seq-b.through_seq);
  for (const receipt of parsedReceipts) {
    const ack = await api.localSyncPeerAck(receipt.receiver_id);
    if (ack !== null && receipt.through_seq <= ack) continue;
    await api.acceptLocalSyncReceipt(receipt);
    result.acknowledgements++;
  }
  for (const peerId of peers) {
    const ack = await api.localSyncPeerAck(peerId);
    if (ack === null) await api.acknowledgeLocalChanges(peerId,{dataset_id:api.datasetId,seq:0});
    const after = { dataset_id:api.datasetId,seq:ack ?? 0 };
    let pageLimit = limit;
    let packet = await api.exportLocalSyncPacket(after,pageLimit);
    while (packet && encodeLocalPacket(packet).length > maxPacketBytes && pageLimit > 1) {
      pageLimit = Math.max(1, Math.floor(pageLimit / 2));
      packet = await api.exportLocalSyncPacket(after,pageLimit);
    }
    if (packet && encodeLocalPacket(packet).length > maxPacketBytes) throw new AppError('invalidLimit');
    if (packet) {
      if (mailbox.attachments) for (const event of packet.events) {
        if (event.entity_type !== 'attachment' || event.payload.purged !== 0 ||
            typeof event.payload.record_id !== 'string') continue;
        const view = await api.getAttachmentView(event.entity_id,event.payload.record_id);
        if (view.status === 'present' && !view.large) {
          await publishLocalAttachment(api,event.payload.record_id,event.entity_id,mailbox.attachments);
        }
      }
      await mailbox.publishPacket(encodeLocalPacket(packet));
      result.sent++;
    }
  }
  // An exchange is complete only when the entire current local journal has been
  // applied and acknowledged by every peer, and each peer's inbound cursor moved.
  if (result.sent === 0 && result.gaps === 0) {
    const head = await api.db.read(s => journalCheckpoint(s));
    const ready = await Promise.all(peers.map(async peer => {
      const [ack,received] = await Promise.all([api.localSyncPeerAck(peer),api.localSyncReceiveCursor(peer)]);
      return ack !== null && ack >= head.seq && received > 0;
    }));
    if (ready.every(Boolean)) for (const peer of peers) await api.completeLocalSyncExchange(peer);
  }
  return result;
}
