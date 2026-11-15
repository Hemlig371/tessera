import type { Repository } from '../../src/core/repository';

/** Available part of the Notes acceptance library. Advanced profile modes arrive with their implementations. */
export async function createNotesLibrary(api: Repository, name = 'Заметки (dev/CI)', localDate = '2026-11-15') {
  const library = await api.createLibrary(name);
  const topics = await api.createCollection(library.id, 'Темы', 'Название');
  const notes = await api.createCollection(library.id, 'Заметки', 'Название');
  const body = await api.createField(notes.id, 'Текст', 'markdown');
  const topic = await api.createField(notes.id, 'Тема', 'relation', { target_collection_id: topics.id });
  const date = await api.createField(notes.id, 'Дата', 'date', { default: localDate });
  return { library, topics, notes, body, topic, date };
}
