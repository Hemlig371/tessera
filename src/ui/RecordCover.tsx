import { useEffect, useState } from 'react';
import type { Repository } from '../core/repository';

/** Optional record cover, entirely derived from an existing image field.
 * Never persists image bytes or embeds demo artwork in the application. */
export function RecordCover({ api, ownerId, id }: { api: Repository; ownerId: string; id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void (async () => {
      const view = await api.getAttachmentView(id, ownerId);
      if (view.status !== 'present' || !view.mime.startsWith('image/') || view.size > 12 * 1024 * 1024) return;
      const preview = await api.readAttachmentPreview(id, ownerId);
      if (!active || !preview.mime.startsWith('image/')) return;
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(preview.bytes)], { type: preview.mime }));
      setUrl(objectUrl);
    })().catch(() => { /* An unavailable cover must not block record values. */ });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, id, ownerId]);
  return url ? <img className="tessera-record-cover" src={url} alt="" aria-hidden="true" /> : null;
}
