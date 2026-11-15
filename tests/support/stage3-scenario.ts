import type { Repository } from '../../src/core/repository';
/** Dedicated native acceptance entry only. Same API as UI; no special database implementation. */
export async function stage3Scenario(api: Repository) {
  const library = await api.createLibrary('Связи этапа 3'),
    projects = await api.createCollection(library.id, 'Проекты', 'Название'),
    tasks = await api.createCollection(library.id, 'Задачи', 'Название');
  const forward = await api.createField(tasks.id, 'Проект', 'relation', {
    target_collection_id: projects.id,
  });
  const many = await api.createField(tasks.id, 'Ссылки', 'relation', {
    target_collection_id: projects.id,
    multiple: true,
  });
  const reverse = await api.createField(projects.id, 'Задачи проекта', 'backlink', {
    source_field_id: forward.id,
  });
  const parent = await api.saveEntry(projects.id, { [projects.primary_field_id]: 'Родитель связи' });
  const child = await api.createLinkedEntry(parent.id, reverse.id, {
    [tasks.primary_field_id]: 'Дочерняя запись',
    [many.id]: [parent.id],
  });
  if (
    child.data[forward.id] !== parent.id ||
    (await api.getRelationPage(parent.id, reverse.id)).items[0]?.id !== child.id
  )
    throw new Error('native reverse relation failed');
  await api.setDeleted('record', parent.id, true);
  await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'Правка со ссылкой' }, child.id);
  if ((await api.getRelationPage(child.id, forward.id)).items[0]?.status !== 'deleted')
    throw new Error('native deleted target failed');
  await api.setDeleted('record', parent.id, false);
  await api.rebuildRelationIndex();
  if ((await api.getRelationPage(parent.id, reverse.id)).items.length !== 1)
    throw new Error('native relation rebuild failed');
  let rejected = false;
  try {
    await api.createLinkedEntry(parent.id, reverse.id, { [tasks.primary_field_id]: '' });
  } catch {
    rejected = true;
  }
  if (!rejected || (await api.queryEntries({ collection_id: tasks.id })).items.length !== 1)
    throw new Error('native linked rollback failed');
  return { library, projects, tasks, parent, child, forward, reverse };
}
