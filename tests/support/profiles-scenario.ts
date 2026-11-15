import type { Repository } from '../../src/core/repository';
import { createNotesLibrary } from '../fixtures/notes';

/** Generic Notes/profile acceptance on the real platform Repository. */
export async function profilesScenario(api: Repository) {
  const name = 'Заметки: профили (dev/CI)';
  const existing = (await api.listLibraries()).find(library => library.name === name);
  if (existing) return existing.id;
  const fixture = await createNotesLibrary(api, name);
  const { notes, body } = fixture;
  const first = await api.saveEntry(notes.id, { [notes.primary_field_id]: 'Альфа', [body.id]: 'Длинный текст первой заметки' });
  const second = await api.saveEntry(notes.id, { [notes.primary_field_id]: 'Бета', [body.id]: 'Вторая заметка' });
  const [all] = await api.listDisplayProfiles(notes.id);
  await api.updateDisplayProfile(all!.id, { name: 'Все', definition: {
    fields: [{ field_id: notes.primary_field_id, visible: true }, { field_id: body.id, visible: true }],
    list: { sort_field: notes.primary_field_id, direction: 'asc', mode: 'rows' },
  } });
  const beta = await api.createDisplayProfile(notes.id, 'Только Бета', {
    fields: [{ field_id: notes.primary_field_id, visible: true }],
    list: { mode: 'cards', filters: [{ field_id: notes.primary_field_id, op: 'eq', value: 'Бета' }] },
  });
  if ((await api.queryEntries({ collection_id: notes.id, profile_id: beta.id })).items.map(row => row.id).join() !== second.id) throw new Error('profile filter failed');
  const rows = (await api.queryEntries({ collection_id: notes.id, profile_id: all!.id })).items;
  if (rows.map(row => row.id).join() !== [first.id,second.id].join()) throw new Error('profile order failed');
  return fixture.library.id;
}
