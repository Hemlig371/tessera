import type { Repository } from '../../src/core/repository';

/** Deterministic user content; UUIDs and technical timestamps are assigned by the repository. */
export async function createKnowledgeFixture(api: Repository) {
  const library = await api.createLibrary('База знаний (dev/CI)');
  const materials = await api.createCollection(library.id, 'Материалы', 'Название');
  const topics = await api.createCollection(library.id, 'Темы', 'Название');
  const sources = await api.createCollection(library.id, 'Источники', 'Название');
  const body = await api.createField(materials.id, 'Описание', 'markdown');
  const date = await api.createField(materials.id, 'Дата', 'date');
  const read = await api.createField(materials.id, 'Прочитано', 'boolean', { default: false });
  const topicLink = await api.createField(materials.id, 'Темы', 'relation', { target_collection_id: topics.id, multiple: true });
  const sourceLink = await api.createField(materials.id, 'Источники', 'relation', { target_collection_id: sources.id, multiple: true });
  const related = await api.createField(materials.id, 'Связанные материалы', 'relation', { target_collection_id: materials.id, multiple: true });
  await api.createField(topics.id, 'Материалы темы', 'backlink', { source_field_id: topicLink.id });
  await api.createField(sources.id, 'Материалы источника', 'backlink', { source_field_id: sourceLink.id });
  const url = await api.createField(sources.id, 'URL', 'text');
  const architecture = await api.saveEntry(topics.id, { [topics.primary_field_id]: 'Архитектура' });
  const unicode = await api.saveEntry(topics.id, { [topics.primary_field_id]: 'Unicode ёж' });
  const sqlite = await api.saveEntry(sources.id, { [sources.primary_field_id]: 'SQLite', [url.id]: 'https://sqlite.org/' });
  await api.saveUiConfig(materials.id, 'list', { fields: (await api.listFields(materials.id)).map(field => ({ field_id: field.id, visible: field.id === materials.primary_field_id })), list: { sort_field: materials.primary_field_id, direction: 'asc' } });
  await api.importEntries(materials.id, Array.from({ length: 250 }, (_, index) => {
    const number = index + 1;
    return { [materials.primary_field_id]: 'Материал ' + String(number).padStart(3, '0'),
      [body.id]: '# Материал\n\nЁж: знания, Markdown и Unicode.\n\n' + (number === 220 ? 'Длинное описание материала для чтения и редактирования.\n\n'.repeat(80) : 'Краткая заметка.'),
      [date.id]: '2026-01-15', [read.id]: false, [topicLink.id]: number === 220 ? [architecture.id, unicode.id] : [architecture.id], [sourceLink.id]: [sqlite.id] };
  }));
  const find = async (title: string) => {
    const result = await api.queryEntries({ collection_id: materials.id, filters: [{ field_id: materials.primary_field_id, op: 'eq', value: title }], limit: 1 });
    const record = result.items[0]; if (!record) throw new Error('Missing knowledge fixture record'); return (await api.getEntry(record.id))!;
  };
  const first = await find('Материал 220'), second = await find('Материал 221');
  await api.saveEntry(materials.id, { [related.id]: [second.id] }, first.id, first.hlc);
  await api.saveEntry(materials.id, { [related.id]: [first.id] }, second.id, second.hlc);
  return { library_id: library.id, collection_id: materials.id, primary: materials.primary_field_id, body: body.id, related: related.id, first: first.id, second: second.id,
    topics: topics.id, sources: sources.id, topic: architecture.id };
}
