import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { createProjectsLibrary } from '../fixtures/projects';
import { Repository } from '../../src/core/repository';

describe.each(adapters)('%s creation presets', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('resolves live local dates without record/version/clock writes, preserves zero/false and shares standard validation', async () => {
    f = await fixture(kind); const api = f.api!, sample = await createProjectsLibrary(api);
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records'), versions: await s.query('SELECT * FROM record_versions'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'"), log: await s.query('SELECT * FROM change_log ORDER BY seq') }));
    const before = await snapshot();
    const choice = { kind: 'preset' as const, preset_id: sample.bug.id };
    const resolved = await api.resolveCreation(sample.tasks.id, choice, new Date(2026,10,15,23,59));
    expect(resolved).toEqual({ form: 'quick', data: { [sample.kind.id]: 'Ошибка', [sample.status.id]: 'Новая', [sample.priority.id]: 0, [sample.done.id]: false, [sample.due.id]: '2026-11-15' } });
    expect((await api.resolveCreation(sample.tasks.id, choice, new Date(2026,10,16,0,1))).data[sample.due.id]).toBe('2026-11-16');
    expect(await snapshot()).toEqual(before);
    await expect(api.saveQuickEntry(sample.tasks.id, resolved.data)).rejects.toThrow('requiredText');
    const project = await api.saveEntry(sample.projects.id, { [sample.projects.primary_field_id]: 'Tessera' });
    const task = await api.saveQuickEntry(sample.tasks.id, { ...resolved.data, [sample.tasks.primary_field_id]: 'Исправить', [sample.project.id]: project.id });
    const child = await api.saveEntry(sample.tasks.id, { [sample.tasks.primary_field_id]: 'Подзадача', [sample.parent.id]: task.id });
    expect((await api.getRelationPage(child.id, sample.parent.id)).items[0]!.id).toBe(task.id);
    expect(task.data).toMatchObject(resolved.data);
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=?', [task.id]))).toHaveLength(1);
    await api.updateField(sample.kind.id, { name: 'Категория' });
    expect((await api.resolveCreation(sample.tasks.id, choice)).data[sample.kind.id]).toBe('Ошибка');
    await api.setDeleted('field', sample.kind.id, true);
    await expect(api.resolveCreation(sample.tasks.id, choice)).rejects.toThrow('invalidPreset');
    expect((await api.listCreationPresets(sample.tasks.id))[0]!.config).toContain(sample.kind.id);
  });
  it('persists default choices independently of UI/layouts, and resets only a deleted assigned preset', async () => {
    f = await fixture(kind); const api = f.api!, sample = await createProjectsLibrary(api);
    const profiles = await api.listDisplayProfiles(sample.tasks.id), quick = await api.getQuickForm(sample.tasks.id);
    await api.setCreationChoice(sample.tasks.id, { kind: 'preset', preset_id: sample.bug.id });
    expect((await api.resolveCreation(sample.tasks.id)).data[sample.kind.id]).toBe('Ошибка');
    await f.db.close(); const db = await f.reopen();
    try {
      const again = await Repository.open(db);
      expect((await again.resolveCreation(sample.tasks.id)).form).toBe('quick');
      await again.updateCreationPreset(sample.bug.id, { name: 'Ошибка', position: 3, definition: { form: 'standard', data: { [sample.priority.id]: 1 }, today_fields: [] } });
      expect(await again.resolveCreation(sample.tasks.id)).toEqual({ form: 'standard', data: { [sample.priority.id]: 1 } });
      await again.setCreationChoice(sample.tasks.id, { kind: 'quick' });
      await again.deleteCreationPreset(sample.bug.id);
      expect(await again.resolveCreation(sample.tasks.id)).toEqual({ form: 'quick', data: {} });
      const preset = await again.createCreationPreset(sample.tasks.id, 'По умолчанию', { form: 'standard', data: {}, today_fields: [] }, true);
      await again.deleteCreationPreset(preset.id);
      expect(await again.resolveCreation(sample.tasks.id)).toEqual({ form: 'standard', data: {} });
      expect(await again.listDisplayProfiles(sample.tasks.id)).toEqual(profiles); expect(await again.getQuickForm(sample.tasks.id)).toEqual(quick);
    } finally { await db.close(); }
  });
  it('rejects foreign/invalid fields and rolls preset/default/clock/journal back together', async () => {
    f = await fixture(kind); const api = f.api!, sample = await createProjectsLibrary(api);
    await api.startLocalSync();
    await expect(api.setCreationChoice(sample.projects.id, { kind: 'preset', preset_id: sample.bug.id })).rejects.toThrow('invalidPreset');
    await expect(api.createCreationPreset(sample.tasks.id, 'Чужое поле', { form: 'standard', data: { [sample.projects.primary_field_id]: 'Нет' }, today_fields: [] })).rejects.toThrow('invalidPreset');
    await expect(api.createCreationPreset(sample.tasks.id, 'Дата в числе', { form: 'standard', data: {}, today_fields: [sample.priority.id] })).rejects.toThrow('invalidPreset');
    const snapshot = () => f.db.read(async s => ({ presets: await s.query('SELECT * FROM creation_presets ORDER BY id'), collections: await s.query('SELECT * FROM collections ORDER BY id'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'"), log: await s.query('SELECT * FROM change_log ORDER BY seq') }));
    const before = await snapshot();
    await f.db.transaction(s => s.execute("CREATE TRIGGER fail_preset BEFORE INSERT ON change_log WHEN NEW.entity_type='collection' BEGIN SELECT RAISE(ABORT,'preset failure'); END"));
    await expect(api.createCreationPreset(sample.tasks.id, 'Не создавать', { form: 'standard', data: {}, today_fields: [] }, true)).rejects.toThrow('preset failure');
    expect(await snapshot()).toEqual(before);
    await expect(api.updateCreationPreset(sample.bug.id, { name: 'Не менять', make_default: true })).rejects.toThrow('preset failure');
    expect(await snapshot()).toEqual(before);
  });
});
