import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, DisplayProfile, EntryFilter, Field } from '../core/model';
import type { LibrarySummaryDefinition, SummaryWidget } from '../core/library-summary';
import { modeFields } from '../core/mode-options';
import type { Repository } from '../core/repository';
import { errorKey } from './common';
import { SummaryFormulaInput } from './SummaryFormulaInput';
import { RelationInput } from './RelationInput';
import { FieldInput } from './common';

type Kind = SummaryWidget['kind'];
const kinds: Kind[] = ['metric', 'progress', 'chart', 'list', 'table', 'calendar', 'create'];
function newWidget(kind: Kind, collectionId: string, fields: readonly Field[], previous?: SummaryWidget): SummaryWidget {
  const base = { id: previous?.id ?? crypto.randomUUID(), collection_id: collectionId, title: previous?.title ?? '', width: previous?.width ?? (1 as const) };
  const numeric = fields.find(f => ['integer','decimal','money','formula','aggregate'].includes(f.type));
  const group = fields.find(f => !['secret','relation','backlink','file','image','json','coordinates','date_range','multiselect'].includes(f.type));
  const formula = numeric ? `SUM([${numeric.id}])` : `COUNT([${group?.id ?? ''}])`;
  switch (kind) {
    case 'metric': return { ...base, kind, formula };
    case 'progress': return { ...base, kind, formula, goal: '100' };
    case 'chart': return { ...base, kind, group_field: group?.id ?? '', measure: { operation: 'count' }, group_period: 'value', style: 'bar' };
    case 'list':
    case 'table': return { ...base, kind, field_ids: fields.filter(f => f.type !== 'secret').slice(0, 3).map(f => f.id), limit: 10 };
    case 'calendar': return { ...base, kind, calendar_field: modeFields('calendar', fields, collectionId)[0]?.id ?? '' };
    case 'create': return { ...base, kind };
  }
}
export function LibrarySummaryEditor({ api, libraryId, busy, cancel, save }: {
  api: Repository; libraryId: string; busy: boolean; cancel: () => void; save: (value: LibrarySummaryDefinition) => void;
}) {
  const { t } = useTranslation();
  const [widgets, setWidgets] = useState<SummaryWidget[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [fields, setFields] = useState<Record<string, Field[]>>({});
  const [profiles, setProfiles] = useState<Record<string, DisplayProfile[]>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([api.getLibrarySummary(libraryId), api.listCollections(libraryId)]).then(async ([summary, collections]) => {
      const values = await Promise.all(collections.map(async c => ({ id: c.id, fields: await api.listFields(c.id), profiles: await api.listDisplayProfiles(c.id) })));
      if (!active) return;
      setCollections(collections.filter(c => !c.system_kind));
      setFields(Object.fromEntries(values.map(v => [v.id, v.fields])));
      setProfiles(Object.fromEntries(values.map(v => [v.id, v.profiles])));
      setWidgets(summary.widgets);
    }).catch(e => { if (active) setError(errorKey(e)); });
    return () => { active = false; };
  }, [api, libraryId]);
  const replace = (widget: SummaryWidget) => setWidgets(old => old?.map(item => item.id === widget.id ? widget : item) ?? []);
  if (!widgets) return <div role="status">{error ? t('errors.' + error, { defaultValue: t('errors.unexpected') }) : t('loadingSettings')}</div>;
  const available = collections[0];
  return <form className="settings-form library-summary-editor" onSubmit={event => { event.preventDefault(); save({ widgets }); }}>
    <p className="screen-hint">{t('summaryEditorHint')}</p>
    {widgets.map((widget, index) => {
      const ownedFields = fields[widget.collection_id] ?? [];
      const collectionProfiles = profiles[widget.collection_id] ?? [];
      const groupFields = ownedFields.filter(f => !['secret','relation','backlink','file','image','json','coordinates','date_range','multiselect'].includes(f.type));
      const dateFields = modeFields('calendar', ownedFields, widget.collection_id);
      return <fieldset key={widget.id} disabled={busy} className="summary-widget-settings" data-widget-id={widget.id}>
        <legend>{widget.title || t('summaryNewWidget')}</legend>
        <div className="form-actions">
          <button type="button" disabled={index === 0} onClick={() => setWidgets(old => { const next = [...old!]; [next[index-1],next[index]] = [next[index]!,next[index-1]!]; return next; })}>{t('moveUp', { name: widget.title })}</button>
          <button type="button" disabled={index === widgets.length - 1} onClick={() => setWidgets(old => { const next = [...old!]; [next[index],next[index+1]] = [next[index+1]!,next[index]!]; return next; })}>{t('moveDown', { name: widget.title })}</button>
          <button type="button" onClick={() => setWidgets(old => old!.filter(item => item.id !== widget.id))}>{t('remove')}</button>
        </div>
        <label>{t('summaryTitle')}<input required maxLength={200} value={widget.title} onChange={e => replace({ ...widget, title: e.target.value })} /></label>
        <label>{t('summaryKind')}<select value={widget.kind} onChange={e => replace(newWidget(e.target.value as Kind, widget.collection_id, ownedFields, widget))}>{kinds.map(kind => <option key={kind} value={kind}>{t('summaryKinds.' + kind)}</option>)}</select></label>
        <label>{t('summarySource')}<select value={widget.collection_id} onChange={e => { const id = e.target.value; replace(newWidget(widget.kind, id, fields[id] ?? [], { id: widget.id, title: widget.title, width: widget.width } as SummaryWidget)); }}>
          {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label>{t('summaryWidth')}<select value={widget.width} onChange={e => replace({ ...widget, width: Number(e.target.value) as 1 | 2 })}><option value="1">1</option><option value="2">2</option></select></label>
        {widget.kind !== 'create' && <label>{t('displayProfile')}<select value={widget.profile_id ?? ''} onChange={e => {
          const next = { ...widget };
          delete next.profile_id;
          replace({ ...next, ...(e.target.value ? { profile_id: e.target.value } : {}) });
        }}><option value="">{t('summaryNoProfile')}</option>{collectionProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {widget.kind !== 'create' && <fieldset><legend>{t('filters')}</legend>
          {(widget.filters ?? []).map((filter, filterIndex) => {
            const field = ownedFields.find(f => f.id === filter.field_id);
            if (!field) return <p role="alert" key={filterIndex}>{t('errors.invalidFilter')}</p>;
            const changeFilter = (next: EntryFilter) => replace({ ...widget, filters: (widget.filters ?? []).map((f, i) => i === filterIndex ? next : f) });
            return <div className="summary-filter" key={filterIndex}>
              <label>{t('field')}<select value={filter.field_id} onChange={e => changeFilter({ field_id: e.target.value, op: 'empty' })}>
                {ownedFields.filter(f => f.type !== 'secret').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select></label>
              <label>{t('condition')}<select value={filter.op} onChange={e => {
                const op = e.target.value as EntryFilter['op'];
                changeFilter({ field_id: field.id, op, ...(!['empty', 'filled'].includes(op) ? { value: null } : {}) });
              }}>
                {(['empty','filled','eq','ne', ...(['relation','backlink','file','image'].includes(field.type) ? [] : ['gt','lt'])] as EntryFilter['op'][]).map(op => <option key={op} value={op}>{t('filterOps.' + op)}</option>)}
              </select></label>
              {!['empty','filled'].includes(filter.op) && (field.type === 'relation' ? <RelationInput api={api} field={field} value={filter.value} change={value => changeFilter({ ...filter, value })} disabled={busy} /> :
                <FieldInput field={field} label={field.name} value={filter.value} change={value => changeFilter({ ...filter, value })} />)}
              <button type="button" onClick={() => replace({ ...widget, filters: (widget.filters ?? []).filter((_, i) => i !== filterIndex) })}>{t('remove')}</button>
            </div>;
          })}
          <button type="button" disabled={!ownedFields.some(f => f.type !== 'secret')} onClick={() => {
            const candidate = ownedFields.find(f => f.type !== 'secret');
            if (candidate) replace({ ...widget, filters: [...(widget.filters ?? []), { field_id: candidate.id, op: 'empty' }] });
          }}>{t('addFilter')}</button>
        </fieldset>}
        {(widget.kind === 'metric' || widget.kind === 'progress') && <>
          <SummaryFormulaInput key={widget.id + ':' + widget.collection_id} fields={Object.values(fields).flat()} collectionId={widget.collection_id}
            value={widget.formula} change={value => replace({ ...widget, formula: value })}
            preview={value => api.previewSummaryFormula(libraryId, widget.collection_id, value, widget.profile_id)} busy={busy} />
          {widget.kind === 'progress' && <label>{t('summaryGoalLabel')}<input required value={widget.goal} onChange={e => replace({ ...widget, goal: e.target.value })} /></label>}
        </>}
        {widget.kind === 'chart' && <>
          <label>{t('groupBy')}<select required value={widget.group_field} onChange={e => replace({ ...widget, group_field: e.target.value })}>{groupFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>{t('summaryChartStyle')}<select value={widget.style} onChange={e => replace({ ...widget, style: e.target.value as 'bar' | 'line' })}><option value="bar">{t('summaryBar')}</option><option value="line">{t('summaryLine')}</option></select></label>
          <label>{t('summaryOperation')}<select value={widget.measure.operation} onChange={e => replace({ ...widget, measure: e.target.value === 'count' ? { operation: 'count' } : { operation: e.target.value as 'sum' | 'average' | 'min' | 'max', field_id: ownedFields.find(f => ['integer','decimal','money'].includes(f.type))?.id ?? '' } })}>{['count','sum','average','min','max'].map(op => <option key={op} value={op}>{t('summaryOperations.' + op)}</option>)}</select></label>
          {widget.measure.operation !== 'count' && <label>{t('summaryField')}<select value={widget.measure.field_id ?? ''} onChange={e => replace({ ...widget, measure: { ...widget.measure, field_id: e.target.value } })}>{ownedFields.filter(f => ['integer','decimal','money','formula','aggregate'].includes(f.type)).map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>}
          {dateFields.some(f => f.id === widget.group_field) && <label>{t('summaryPeriod')}<select value={widget.group_period ?? 'value'} onChange={e => replace({ ...widget, group_period: e.target.value as 'value' | 'day' | 'week' | 'month' })}>{['value','day','week','month'].map(p => <option key={p} value={p}>{t('summaryPeriods.' + p)}</option>)}</select></label>}
        </>}
        {(widget.kind === 'list' || widget.kind === 'table') && <>
          <label>{t('summaryLimit')}<input type="number" min={1} max={50} required value={widget.limit} onChange={e => replace({ ...widget, limit: Number(e.target.value) })} /></label>
          <fieldset><legend>{t('visible')}</legend>{ownedFields.filter(f => f.type !== 'secret').map(f => <label className="check" key={f.id}><input type="checkbox" checked={widget.field_ids.includes(f.id)} onChange={e => replace({ ...widget, field_ids: e.target.checked ? [...widget.field_ids, f.id] : widget.field_ids.filter(id => id !== f.id) })} />{f.name}</label>)}</fieldset>
        </>}
        {widget.kind === 'calendar' && <label>{t('modeField')}<select required value={widget.calendar_field} onChange={e => replace({ ...widget, calendar_field: e.target.value })}>{dateFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      </fieldset>;
    })}
    <div className="form-actions">
      <button type="button" disabled={busy || !available} onClick={() => setWidgets(old => [...old!, newWidget('create', available!.id, fields[available!.id] ?? [])])}>{t('summaryAddWidget')}</button>
      <button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button>
      <button type="submit" className="primary" disabled={busy || !collections.length && !!widgets.length}>{t('save')}</button>
    </div>
  </form>;
}
