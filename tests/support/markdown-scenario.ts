import type { Repository } from '../../src/core/repository';
import { createNotesLibrary } from '../fixtures/notes';

export async function markdownScenario(api: Repository) {
  const name = 'Заметки: Markdown (dev/CI)';
  const existing = (await api.listLibraries()).find(library => library.name === name);
  const sample = existing ? null : await createNotesLibrary(api, name);
  const library = existing ?? sample!.library;
  const collection = sample?.notes ?? (await api.listCollections(library.id)).find(collection => collection.name === 'Заметки')!;
  const fields = await api.listFields(collection.id), body = fields.find(field => field.name === 'Текст')!;
  if (sample) {
    await api.updateCollection(collection.id, { incoming_field_id: body.id });
    const inbox = await api.getInbox(), original = '# Native Markdown **ёж**\r\n\r\n**Безопасно** иголкаёж\r\n<script>window.nativeMarkdownXss=true</script>';
    await api.updateCollection(collection.id, { inbox_mapping: { title_field_id: collection.primary_field_id, body_field_id: body.id } });
    const row = await api.saveEntry(inbox.id, { [inbox.incoming_field_id]: original });
    const preview = await api.previewInboxMove(row.id, collection.id, row.hlc);
    const moved = await api.moveInboxEntry(row.id, collection.id, preview.data, row.hlc);
    if (moved.id !== row.id || moved.created_at !== row.created_at || moved.updated_at !== row.updated_at || await api.inboxOriginal(moved) !== original) throw new Error('native Markdown move lost source data');
    if ((await api.queryEntries({ collection_id: collection.id, search: 'иголка' })).items[0]?.id !== row.id) throw new Error('native Markdown search failed');
  }
  return { library_id: library.id, collection_id: collection.id, primary_field_id: collection.primary_field_id, body_field_id: body.id };
}
