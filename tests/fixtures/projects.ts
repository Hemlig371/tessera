import type { Repository } from '../../src/core/repository';

/** Implemented subset: universal relations, text statuses, presets. Kanban/tree modes arrive later. */
export async function createProjectsLibrary(api: Repository, name = 'Проекты и задачи (dev/CI)') {
  const library = await api.createLibrary(name);
  const projects = await api.createCollection(library.id, 'Проекты', 'Название');
  const tasks = await api.createCollection(library.id, 'Задачи', 'Название');
  const description = await api.createField(tasks.id, 'Описание', 'markdown');
  const project = await api.createField(tasks.id, 'Проект', 'relation', { target_collection_id: projects.id });
  const parent = await api.createField(tasks.id, 'Родитель', 'relation', { target_collection_id: tasks.id });
  const status = await api.createField(tasks.id, 'Статус', 'text', { default: 'Новая' });
  const priority = await api.createField(tasks.id, 'Приоритет', 'integer', { default: 0 });
  const done = await api.createField(tasks.id, 'Готово', 'boolean', { default: false });
  const due = await api.createField(tasks.id, 'Срок', 'date');
  const kind = await api.createField(tasks.id, 'Тип', 'text');
  const bug = await api.createCreationPreset(tasks.id, 'Новый баг', { form: 'quick',
    data: { [kind.id]: 'Ошибка', [status.id]: 'Новая', [priority.id]: 0, [done.id]: false }, today_fields: [due.id] });
  return { library, projects, tasks, description, project, parent, status, priority, done, due, kind, bug };
}
