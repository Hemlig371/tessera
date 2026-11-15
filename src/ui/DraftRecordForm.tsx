import { useEffect, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { DraftSession, type Draft, type DraftAction, type DraftStore } from '../core/drafts';
import type { Entry } from '../core/model';
import { ErrorMessage, errorKey } from './common';
import { RecordForm } from './RecordForm';

export type DraftSave = (data: Entry['data'], action: DraftAction, complete: () => Promise<void>) => void;
export function DraftRecordForm({ store, action, restored, registerClose, warn, save, ...props }:
  Omit<ComponentProps<typeof RecordForm>, 'save' | 'entry' | 'creating'> & { store: DraftStore; action: DraftAction; restored?: Draft;
    registerClose: (close: (() => Promise<void>) | null) => void; warn: () => void; save: DraftSave }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ session: DraftSession; initial: Entry['data']; changed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true, session: DraftSession | undefined;
    const scope = { dataset_id: props.api.datasetId, library_id: props.collection.library_id, collection_id: props.collection.id };
    const load = async () => {
      let draft = restored ?? await store.load(scope);
      if (draft && await props.api.getDraftTarget(draft.action.create_id)) {
        if (!active) return;
        await store.remove(scope); draft = null;
      }
      if (!active) return;
      session = new DraftSession(store, scope, draft?.action ?? action, props.fields,
        () => { if (active) setError('draftWrite'); }, draft ?? undefined);
      setState({ session, initial: { ...props.initialData, ...draft?.data },
        changed: !!draft && Object.entries(draft.field_types).some(([id, type]) => props.fields.find(field => field.id === id)?.type !== type) });
    };
    void load().catch(e => { if (active) setError(errorKey(e)); });
    registerClose(async () => { await session?.close(); });
    return () => { active = false; session?.dispose(); registerClose(null); };
    // The creation form is keyed by its scope. Busy flags must not replace the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!state) return <>{error ? <ErrorMessage code={error} /> : <p role="status">{t('loading')}</p>}<button disabled={props.busy} onClick={props.cancel}>{t('close')}</button></>;
  return <>
    {error && <ErrorMessage code={error} />}
    {state.changed && <p role="status">{t('draftSchemaChanged')}</p>}
    <RecordForm {...props} creating initialData={state.initial}
      change={data => state.session.change(data)} save={data => save(data, state.session.action, async () => {
        try { await state.session.finish(); } catch { warn(); }
      })} />
  </>;
}
