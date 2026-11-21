import { AppError } from './errors';
import { UUID_RE } from './model';
import type { LocalSyncMailbox } from './local-sync-engine';
import { decodeLocalPacket, parseLocalReceipt } from './sync-protocol';
import { openSyncBytes, sealSyncBytes, type SecureKind } from './secure-sync-envelope';

/** Native email layer sees only opaque authenticated wire bytes; no group key. */
export interface OpaqueSyncTransport {
  list(kind: 'packet' | 'receipt'): Promise<readonly Uint8Array[]>;
  send(kind: 'packet' | 'receipt', encrypted: Uint8Array): Promise<void>;
  attachments?: {
    put(id: string, offset: number, encrypted: Uint8Array): Promise<void>;
    get(id: string, offset: number): Promise<Uint8Array>;
    exists?(id: string, offset: number): Promise<boolean>;
  };
}
/** Shared-key trust is scoped to one dataset; M5 SQLite cursors remain replay authority. */
export function encryptedSyncMailbox(
  transport: OpaqueSyncTransport, key: CryptoKey, datasetId: string, deviceId: string
): LocalSyncMailbox {
  if (!UUID_RE.test(datasetId) || !UUID_RE.test(deviceId)) throw new AppError('invalidId');
  const wrap = async (kind: SecureKind, messageId: string, bytes: Uint8Array) =>
    sealSyncBytes(key,{dataset_id:datasetId,sender_id:deviceId,kind,message_id:messageId},bytes);
  const list = async (kind: 'packet'|'receipt') => {
    const encrypted = await transport.list(kind);
    if (encrypted.length > 2048) throw new AppError('invalidLimit');
    const decrypted: Uint8Array[] = [];
    for (const wire of encrypted) {
      const opened = await openSyncBytes(key,wire,{dataset_id:datasetId,kind});
      decrypted.push(opened.bytes);
    }
    return decrypted;
  };
  return {
    listPackets:()=>list('packet'),
    listReceipts:()=>list('receipt'),
    async publishPacket(bytes) {
      const p = decodeLocalPacket(bytes);
      if (p.dataset_id !== datasetId || p.sender_id !== deviceId) throw new AppError('invalidSyncPacket');
      await transport.send('packet',await wrap('packet',p.packet_id,bytes));
    },
    async publishReceipt(bytes) {
      let receipt;
      try { receipt = parseLocalReceipt(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown); }
      catch { throw new AppError('invalidSyncPacket'); }
      if (receipt.dataset_id !== datasetId || receipt.receiver_id !== deviceId) throw new AppError('invalidSyncPacket');
      await transport.send('receipt',await wrap('receipt',receipt.packet_id,bytes));
    },
    attachments: transport.attachments ? {
      async writeChunk(chunk) {
        if (chunk.dataset_id !== datasetId || chunk.source_id !== deviceId ||
            !UUID_RE.test(chunk.attachment_id) || !Number.isSafeInteger(chunk.offset) || chunk.offset < 0 ||
            chunk.bytes.length > 256*1024) throw new AppError('invalidSyncPacket');
        // Deterministic logical ID for transport lookup, never used as an IV.
        await transport.attachments!.put(chunk.attachment_id,chunk.offset,
          await wrap('chunk',chunk.attachment_id,chunk.bytes));
      },
      async readChunk(req) {
        if (req.dataset_id !== datasetId || !UUID_RE.test(req.source_id) ||
            !UUID_RE.test(req.attachment_id) || !Number.isSafeInteger(req.offset) ||
            req.offset < 0 || req.length < 1 || req.length > 256*1024) throw new AppError('invalidSyncPacket');
        const opened = await openSyncBytes(key,
          await transport.attachments!.get(req.attachment_id,req.offset),{dataset_id:datasetId,kind:'chunk'});
        if (opened.header.sender_id !== req.source_id ||
            opened.header.message_id !== req.attachment_id ||
            opened.bytes.length !== req.length) throw new AppError('invalidSyncPacket');
        return opened.bytes;
      },
      hasFirstChunk: transport.attachments.exists
        ? async req => req.dataset_id === datasetId &&
          transport.attachments!.exists!(req.attachment_id,0)
        : undefined,
    } : undefined,
  };
}
