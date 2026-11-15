import type { Repository } from '../../src/core/repository';
import { createNotesLibrary } from '../fixtures/notes';
export async function draftFixture(api: Repository) {
  const existing = (await api.listLibraries()).find(row => row.name === 'Заметки (dev/CI)');
  const library = existing ?? (await createNotesLibrary(api)).library;
  const collection = (await api.listCollections(library.id)).find(row => row.name === 'Заметки')!;
  const fields = await api.listFields(collection.id);
  return { dataset_id: api.datasetId, library_id: library.id, collection_id: collection.id, primary_field_id: collection.primary_field_id,
    body_field_id: fields.find(field => field.name === 'Текст')!.id };
}
