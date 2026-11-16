import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryCursor, EntryListItem, Field, JsonValue, RelationItem } from '../core/model';
import type { Repository } from '../core/repository';
import { fieldConfig } from '../core/validation';
import { relationIds } from '../core/relations';
import { ErrorMessage, errorKey } from './common';

export function RelationInput({
  api,
  field,
  value,
  change,
  disabled = false,
  pinnedIds = [],
}: {
  api: Repository;
  field: Field;
  value: JsonValue | undefined;
  change: (value: JsonValue) => void;
  disabled?: boolean;
  pinnedIds?: string[];
}) {
  const { t } = useTranslation();
  const ids = relationIds(value),
    multiple = !!fieldConfig(field).multiple;
  const [search, setSearch] = useState(''),
    [rows, setRows] = useState<EntryListItem[]>([]),
    [next, setNext] = useState<EntryCursor | null>(null);
  const [selected, setSelected] = useState<RelationItem[]>([]),
    [offset, setOffset] = useState(0),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<(EntryCursor | null)[]>([null]);
  const idsKey = JSON.stringify(ids),
    chunkKey = JSON.stringify(ids.slice(offset, offset + 50));
  useEffect(() => {
    let active = true;
    api
      .resolveRelationValues(field.id, JSON.parse(chunkKey) as string[])
      .then((items) => {
        if (active) setSelected(items);
      })
      .catch((e) => {
        if (active) setError(errorKey(e));
      });
    return () => {
      active = false;
    };
  }, [api, field.id, chunkKey]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .queryRelationTargets(field.id, { search, limit: 50 })
        .then((page) => {
          if (active) {
            setRows(page.items);
            setPages([null]);
            setNext(page.next);
            setError(null);
          }
        })
        .catch((e) => {
          if (active) {
            setRows([]);
            setNext(null);
            setError(errorKey(e));
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, field.id, search]);
  async function previous() {
    if (pages.length < 2) return;
    setLoading(true);
    try {
      const page = await api.queryRelationTargets(field.id, {
        search,
        cursor: pages[pages.length - 2],
        limit: 50,
      });
      setRows(page.items);
      setNext(page.next);
      setPages((old) => old.slice(0, -1));
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setLoading(false);
    }
  }
  function choose(id: string) {
    const current = JSON.parse(idsKey) as string[];
    change(multiple ? [...new Set([...current, id])] : id);
    setOffset(0);
  }
  async function more() {
    if (!next) return;
    setLoading(true);
    try {
      const page = await api.queryRelationTargets(field.id, { search, cursor: next, limit: 50 });
      setPages((old) => [...old, next]);
      setRows(page.items);
      setNext(page.next);
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="relation-input" role="group" aria-label={field.name} aria-busy={loading}>
      {!!ids.length && (
        <>
          <ul className="relation-chips">
            {selected.map((item) => (
              <li key={item.id}>
                <span>
                  {item.title || item.id}
                  {item.status !== 'available' && <small> · {t(`relationStatus.${item.status}`)}</small>}
                </span>
                <button
                  type="button"
                  disabled={disabled || pinnedIds.includes(item.id)}
                  aria-label={t('unlinkValue', { name: item.title || item.id })}
                  onClick={() => {
                    const result = ids.filter((id) => id !== item.id);
                    change(multiple ? result : (result[0] ?? null));
                    setOffset(0);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="relation-paging">
            {t('selectedRelations', { count: ids.length })}
            {offset > 0 && (
              <button type="button" disabled={disabled} onClick={() => setOffset((n) => Math.max(0, n - 50))}>
                {t('previousPage')}
              </button>
            )}
            {offset + 50 < ids.length && (
              <button type="button" disabled={disabled} onClick={() => setOffset((n) => n + 50)}>
                {t('nextPage')}
              </button>
            )}
          </div>
        </>
      )}
      <label>
        {t('relationSearch')}
        <input
          type="search"
          value={search}
          onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}}
          disabled={disabled}
          onChange={(e) => {
            setLoading(true);
            setSearch(e.target.value);
          }}
        />
      </label>
      {error && <ErrorMessage code={error} />}
      <div className="relation-options">
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            disabled={disabled || ids.includes(row.id) || (!multiple && pinnedIds.length > 0)}
            onClick={() => choose(row.id)}
          >
            {row.title || t('unset')}
            {ids.includes(row.id) && <span aria-hidden="true"> ✓</span>}
          </button>
        ))}
      </div>
      {loading && <small role="status">{t('loading')}</small>}
      {!loading && !rows.length && !error && <small>{t('noResults')}</small>}
      {pages.length > 1 && (
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            void previous();
          }}
        >
          {t('previousPage')}
        </button>
      )}
      {next && (
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            void more();
          }}
        >
          {t('nextPage')}
        </button>
      )}
    </div>
  );
}
