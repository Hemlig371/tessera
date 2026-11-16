import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Entry, Field, RelationPage } from '../core/model';
import type { Repository } from '../core/repository';
import { ErrorMessage, errorKey } from './common';
export function RelationBlock({
  api,
  entry,
  field,
  open,
  create,
  busy,
  readOnly = false,
}: {
  api: Repository;
  entry: Entry;
  field: Field;
  open?: (id: string) => void;
  create?: () => void;
  busy: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<RelationPage>({ items: [], next: null, available: false }),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: page.items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 60,
    overscan: 3,
    getItemKey: (i) => page.items[i]!.id,
  });
  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .getRelationPage(entry.id, field.id)
      .then((data) => {
        if (active) {
          setPage(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(errorKey(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, entry.id, entry.hlc, field.id, field.hlc]);
  async function more() {
    if (!page.next) return;
    setLoading(true);
    try {
      const next = await api.getRelationPage(entry.id, field.id, page.next);
      setPage((old) => ({ ...next, items: [...old.items, ...next.items] }));
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="relation-block" aria-label={field.name} aria-busy={loading}>
      {error && <ErrorMessage code={error} />}
      {!!page.items.length && (
        <div ref={scroll} className="relation-scroll" style={{ height: Math.min(220, virtual.getTotalSize() + 2) }}>
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((v) => {
              const item = page.items[v.index]!;
              return (
                <button
                  key={item.id}
                  data-index={v.index}
                  ref={virtual.measureElement}
                  type="button"
                  className="relation-row"
                  style={{ transform: `translateY(${v.start}px)` }}
                  disabled={readOnly || busy || item.status !== 'available'}
                  onClick={() => open?.(item.id)}
                >
                  <span>{item.title || item.id}</span>
                  <small>
                    {item.status === 'available' ? item.collection_name : t(`relationStatus.${item.status}`)}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!loading && !page.items.length && <p>{t('noRelations')}</p>}
      {loading && <small>{t('loading')}</small>}
      {!page.available && !loading && !error && <small>{t('relationDefinitionUnavailable')}</small>}
      <div className="relation-actions">
        {page.next && (
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => {
              void more();
            }}
          >
            {t('loadMore')}
          </button>
        )}
        {!readOnly && create && (
          <button type="button" disabled={busy || loading || !page.available} onClick={create}>
            {t('createRelated')}
          </button>
        )}
      </div>
    </div>
  );
}
