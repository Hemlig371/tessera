import { AppError } from './errors';
import { fileChunkSize, type ByteSource } from './attachments';
import { UUID_RE } from './model';
import type { Repository } from './repository';

/** File test transport stores opaque fixed-size chunks without access to SQL or user credentials.
 * M6 wraps transport bytes in authenticated encryption before any real network traffic.
 */
export interface LocalAttachmentMailbox {
  writeChunk(chunk: { dataset_id: string; source_id: string; attachment_id: string; offset: number; bytes: Uint8Array }): Promise<void>;
  readChunk(request: { dataset_id: string; source_id: string; attachment_id: string; offset: number; length: number }): Promise<Uint8Array>;
  /** Optional availability hint: when no source has bytes, metadata remains a placeholder. */
  hasFirstChunk?(request: { dataset_id: string; source_id: string; attachment_id: string }): Promise<boolean>;
}
export type AttachmentTransferResult = 'complete' | 'metadata-only' | 'already-present';

/** Only files up to the shared transfer threshold are published, in <=256 KiB chunks. */
export async function publishLocalAttachment(
  source: Repository, ownerId: string, attachmentId: string, mailbox: LocalAttachmentMailbox
): Promise<AttachmentTransferResult> {
  if (!UUID_RE.test(ownerId) || !UUID_RE.test(attachmentId)) throw new AppError('invalidId');
  const view = await source.getAttachmentView(attachmentId,ownerId,true);
  if (view.large) return 'metadata-only';
  if (view.status !== 'present') throw new AppError(view.status === 'corrupt' ? 'fileCorrupt' : 'fileMissing');
  if (view.size === 0) await mailbox.writeChunk({dataset_id:source.datasetId,source_id:source.deviceId,
    attachment_id:attachmentId,offset:0,bytes:new Uint8Array(0)});
  for (let offset=0; offset<view.size;offset+=fileChunkSize) {
    const length = Math.min(fileChunkSize,view.size-offset);
    const bytes = await source.readLocalSyncAttachmentChunk(attachmentId,ownerId,offset,length);
    await mailbox.writeChunk({dataset_id:source.datasetId,source_id:source.deviceId,attachment_id:attachmentId,offset,bytes});
  }
  return 'complete';
}
/** Read independently staged chunks on demand. The core verifies SHA-256 and length before
 * publishing bytes to the private native store; wrong/missing chunks never commit.
 */
export async function restoreLocalAttachment(
  receiver: Repository, ownerId: string, attachmentId: string, sourceId: string, mailbox: LocalAttachmentMailbox
): Promise<AttachmentTransferResult> {
  if (!UUID_RE.test(ownerId) || !UUID_RE.test(attachmentId) || !UUID_RE.test(sourceId) ||
      sourceId === receiver.deviceId) throw new AppError('invalidId');
  const view = await receiver.getAttachmentView(attachmentId,ownerId,true);
  if (view.large) return 'metadata-only';
  if (view.status === 'present') return 'already-present';
  if (view.status === 'corrupt') throw new AppError('fileCorrupt');
  if (view.status !== 'missing') throw new AppError('invalidAttachment');
  const source: ByteSource = {
    name:view.name,mime:view.mime,size:view.size,
    read: async (offset,length) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
          offset<0 || length<1 || length>fileChunkSize || offset+length>view.size) throw new AppError('invalidFileOffset');
      const bytes = await mailbox.readChunk({dataset_id:receiver.datasetId,source_id:sourceId,attachment_id:attachmentId,offset,length});
      if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new AppError('fileCorrupt');
      return bytes;
    },
  };
  await receiver.restoreAttachmentCopy(attachmentId,ownerId,source);
  return 'complete';
}
