import type { Repository } from '../../src/core/repository';
import { createProjectsLibrary } from '../fixtures/projects';
export async function presetsScenario(api: Repository) {
  const name = 'Проекты и задачи (dev/CI)';
  const existing = (await api.listLibraries()).find(library => library.name === name);
  const sample = existing ? null : await createProjectsLibrary(api, name);
  const library = existing ?? sample!.library;
  if (sample) {
    const before = await api.db.read(s => s.query('SELECT count(*) AS n FROM change_log'));
    const resolved = await api.resolveCreation(sample.tasks.id, { kind: 'preset', preset_id: sample.bug.id }, new Date(2026,10,15,23,59));
    if (resolved.form !== 'quick' || resolved.data[sample.kind.id] !== 'Ошибка' || resolved.data[sample.priority.id] !== 0 ||
      resolved.data[sample.done.id] !== false || resolved.data[sample.due.id] !== '2026-11-15') throw new Error('native preset values failed');
    if (JSON.stringify(await api.db.read(s => s.query('SELECT count(*) AS n FROM change_log'))) !== JSON.stringify(before)) throw new Error('preset resolution wrote to journal');
    if ((await api.listEntries(sample.tasks.id)).items.length) throw new Error('preset created an implicit record');
  }
  const tasks = (await api.listCollections(library.id)).find(collection => collection.name === 'Задачи')!;
  const [preset] = await api.listCreationPresets(tasks.id);
  return { library_id: library.id, collection_id: tasks.id, primary_field_id: tasks.primary_field_id, preset_id: preset?.id ?? null };
}
