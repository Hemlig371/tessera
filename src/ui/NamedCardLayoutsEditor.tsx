import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Field, UiDefinition } from '../core/model';
import type { Repository } from '../core/repository';
import { LayoutEditor } from './LayoutEditor';

/** A named read layout is a view of the same record, not a separate data model. */
export function NamedCardLayoutsEditor({ api, fields, definition, save, cancel, busy }: {
  api: Repository; fields: Field[]; definition: UiDefinition; busy: boolean;
  save: (definition: UiDefinition) => void; cancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<UiDefinition>(definition);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const named = draft.named_cards ?? [];
  const chosen = named.find(card => card.id === selectedId);
  const selectedDefinition = chosen?.definition ?? draft;
  function add() {
    const value = name.trim();
    if (!value || named.length >= 16 || named.some(card => card.name.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
    const id = crypto.randomUUID();
    const { named_cards: _cards, detail_layout_id: _linked, ...base } = selectedDefinition;
    setDraft(old => ({ ...old, named_cards: [...(old.named_cards ?? []), { id, name: value, definition: structuredClone(base) }] }));
    setName('');
    setSelectedId(id);
  }
  function patchCurrent(next: UiDefinition) {
    const { named_cards: _cards, detail_layout_id: _linked, ...clean } = next;
    setDraft(old => selectedId
      ? { ...old, named_cards: (old.named_cards ?? []).map(card => card.id === selectedId ? { ...card, definition: clean } : card) }
      : { ...clean, named_cards: old.named_cards });
    setEditing(false);
  }
  return editing ? <div className="named-card-editor">
    <h2>{chosen?.name ?? t('defaultCardLayout')}</h2>
    <LayoutEditor api={api} kind="card" fields={fields} definition={selectedDefinition} save={patchCurrent} cancel={() => setEditing(false)} busy={busy} />
  </div> : <section className="named-card-editor">
    <p className="screen-hint">{t('namedCardHint')}</p>
    <label>{t('cardLayoutToEdit')}<select disabled={busy} value={selectedId} onChange={event => setSelectedId(event.target.value)}>
      <option value="">{t('defaultCardLayout')}</option>
      {named.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
    </select></label>
    {chosen && <label>{t('cardLayoutName')}<input maxLength={200} disabled={busy} value={chosen.name}
      onChange={event => setDraft(old => ({ ...old, named_cards: old.named_cards?.map(card => card.id === selectedId ? { ...card, name: event.target.value } : card) }))} /></label>}
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => setEditing(true)}>{t('editCardLayout')}</button>
      {chosen && <button type="button" className="danger" disabled={busy} onClick={() => {
        setDraft(old => ({ ...old, named_cards: old.named_cards?.filter(card => card.id !== selectedId) }));
        setSelectedId('');
      }}>{t('deleteCardLayout')}</button>}
    </div>
    <form onSubmit={event => { event.preventDefault(); add(); }}>
      <label>{t('newCardLayout')}<input maxLength={200} required disabled={busy || named.length >= 16} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="submit" disabled={busy || named.length >= 16 || !name.trim() || named.some(card => card.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())}>{t('cloneCardLayout')}</button>
    </form>
    <div className="form-actions">
      <button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button>
      <button type="button" className="primary" disabled={busy || named.some(card => !card.name.trim() || named.filter(other => other.name.trim().toLocaleLowerCase() === card.name.trim().toLocaleLowerCase()).length > 1)} onClick={() => save(draft)}>{t('saveLayout')}</button>
    </div>
  </section>;
}
