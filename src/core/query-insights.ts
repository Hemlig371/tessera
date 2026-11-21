import { AppError } from './errors';
import type { EntryQuery, Field } from './model';
import type { SqlSession } from './ports';
import { freezeQueryDates, queryEntries } from './queries';
import { QuerySummary, type SummaryMeasure, type SummaryResult } from './query-summary';
import { requireId } from './validation';

/** Caller supplies one transaction, including local formula cache updates, for a consistent whole-query result. */
export async function summarizeEntries(session: SqlSession, query: EntryQuery, measures: readonly SummaryMeasure[], signal?: AbortSignal): Promise<SummaryResult[]> {
  query = await freezeQueryDates(session,query);
  requireId(query.collection_id ?? '');
  const fields = await session.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [query.collection_id!]);
  const summaries = measures.map(measure => new QuerySummary(measure, fields));
  let cursor: EntryQuery['cursor'] = null;
  do {
    signal?.throwIfAborted();
    const page = await queryEntries(session, { ...query, cursor, limit: 200 });
    for (const row of page.items) for (const summary of summaries) summary.add(row);
    cursor = page.next;
  } while (cursor);
  signal?.throwIfAborted();
  return summaries.map(summary => summary.result());
}

export async function readProfileQuery(session: SqlSession, collectionId: string, profileId?: string): Promise<EntryQuery> {
  requireId(collectionId); if (profileId) requireId(profileId);
  const [row] = await session.query<{ config: string; id: string }>(`SELECT p.id,p.config FROM display_profiles p JOIN collections c ON c.id=p.collection_id
    JOIN libraries l ON l.id=c.library_id WHERE c.id=? AND p.id=coalesce(?,c.default_profile_id)
    AND p.deleted_at IS NULL AND c.deleted_at IS NULL AND l.deleted_at IS NULL`, [collectionId, profileId ?? null]);
  if (!row) throw new AppError('notFound');
  return { ...(JSON.parse(row.config) as { list?: EntryQuery }).list, collection_id: collectionId, profile_id: row.id };
}
