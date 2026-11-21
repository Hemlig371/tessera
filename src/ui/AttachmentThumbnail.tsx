import { useEffect, useRef, useState } from 'react';
import type { Repository } from '../core/repository';

/** Regenerable, in-process thumbnail cache: never user content in web storage or SQLite. */
const caches = new WeakMap<Repository, Map<string, string>>();
const inFlight = new WeakMap<Repository, Map<string, Promise<string | null>>>();
async function derive(api: Repository, id: string, ownerId: string): Promise<string | null> {
  const cache = caches.get(api) ?? new Map<string, string>();
  caches.set(api, cache);
  const key = ownerId + ':' + id;
  if (cache.has(key)) return cache.get(key)!;
  const running = inFlight.get(api) ?? new Map<string, Promise<string | null>>();
  inFlight.set(api, running);
  if (running.has(key)) return running.get(key)!;
  const work = (async () => {
    try {
      if (typeof createImageBitmap !== 'function') return null;
      const source = await api.readAttachmentThumbnailSource(id, ownerId);
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(source.bytes)], { type: source.mime }), {
        resizeWidth: 160, resizeQuality: 'medium',
      });
      try {
        const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        cache.set(key, url);
        while (cache.size > 64) {
          const oldest = cache.keys().next().value;
          if (!oldest) break;
          const expired = cache.get(oldest)!; cache.delete(oldest); URL.revokeObjectURL(expired);
        }
        return url;
      } finally { bitmap.close(); }
    } catch { return null; }
    finally { running.delete(key); }
  })();
  running.set(key, work);
  return work;
}

export function AttachmentThumbnail({ api, id, ownerId }: { api: Repository; id: string; ownerId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false), [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void derive(api, id, ownerId).then(next => { if (alive) setUrl(next); });
    return () => { alive = false; };
  }, [visible, api, id, ownerId]);
  return <span ref={ref} className="attachment-thumbnail">
    {url && <img src={url} alt="" aria-hidden="true" loading="lazy" width={72} height={72} style={{ objectFit: 'contain' }} />}
  </span>;
}
