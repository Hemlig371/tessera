import type { Repository } from '../../src/core/repository';

/** Isolated API fixture; no direct SQL and never included in a production entry. */
export async function historyFixture(api: Repository) {
  const library = await api.createLibrary('История (dev/CI) ' + crypto.randomUUID().slice(0, 8));
  const collection = await api.createCollection(library.id, 'Редакции', 'Название');
  const markdown = await api.createField(collection.id, 'Текст снимка', 'markdown');
  const originalMarkdown = '## Исходный текст\n\n' + 'Длинный фрагмент. '.repeat(40) + '\n\nКонец полного снимка **без усечения** <script>window.historyInjected=true</script>';
  const unknown = crypto.randomUUID();
  let entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Первая редакция', [unknown]: { historical: true }, [markdown.id]: originalMarkdown });
  const firstVersion = (await api.getHistory(entry.id)).versions[0]!;
  entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Вторая редакция', [markdown.id]: 'Текущий текст' }, entry.id, entry.hlc);
  const other = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Другая запись' });
  return { library_id: library.id, library_name: library.name, collection_id: collection.id, field_id: collection.primary_field_id,
    record_id: entry.id, first_version_id: firstVersion.id, other_id: other.id, unknown_id: unknown };
}

export async function historyRestoreScenario(api: Repository) {
  const fixture = await historyFixture(api), current = await api.getEntry(fixture.record_id);
  if (!current) throw new Error('history fixture missing');
  const restored = await api.restoreEntryVersion(current.id, fixture.first_version_id, current.hlc);
  const history = await api.getHistory(current.id);
  if (restored.data[fixture.field_id] !== 'Первая редакция' || restored.hlc <= current.hlc || history.versions.length !== 3 ||
      history.versions[0]?.snapshot.hlc !== restored.hlc || history.versions[2]?.id !== fixture.first_version_id)
    throw new Error('native history restoration failed');
  await api.clearHistory(current.id);
  if ((await api.getHistory(current.id)).versions.length || (await api.getEntry(current.id))?.hlc !== restored.hlc)
    throw new Error('native history clear changed current record');
}
