import { afterEach, describe, expect, it } from 'vitest';
import { fixture, adapters } from '../support/fixture';
import { Repository } from '../../src/core/repository';
import { csvRecords, exportCsv, parseCsv } from '../../src/core/csv';
import type { RelationCursor } from '../../src/core/model';

describe.each(adapters)('%s relations', (kind) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => {
    await f?.cleanup();
  });
  async function setup() {
    f = await fixture(kind);
    const api = f.api!,
      lib = await api.createLibrary('Работа');
    const projects = await api.createCollection(lib.id, 'Проекты', 'Название'),
      tasks = await api.createCollection(lib.id, 'Задачи', 'Название');
    const relation = await api.createField(tasks.id, 'Проект', 'relation', {
      target_collection_id: projects.id,
    });
    const many = await api.createField(tasks.id, 'Ссылки', 'relation', {
      target_collection_id: projects.id,
      multiple: true,
    });
    const backlink = await api.createField(projects.id, 'Задачи', 'backlink', {
      source_field_id: relation.id,
    });
    const project = await api.saveEntry(projects.id, { [projects.primary_field_id]: 'Tessera' });
    return { api, lib, projects, tasks, relation, many, backlink, project };
  }
  it('stores stable UUIDs, resolves current labels and derives backlinks without rewriting either record', async () => {
    const { api, projects, tasks, relation, backlink, project } = await setup();
    const task = await api.saveEntry(tasks.id, {
      [tasks.primary_field_id]: 'Проверить',
      [relation.id]: project.id,
    });
    expect((await api.getRelationPage(task.id, relation.id)).items[0]).toMatchObject({
      id: project.id,
      title: 'Tessera',
      status: 'available',
    });
    expect((await api.getRelationPage(project.id, backlink.id)).items[0]?.id).toBe(task.id);
    await api.saveEntry(projects.id, { [projects.primary_field_id]: 'Новое имя' }, project.id);
    expect((await api.getRelationPage(task.id, relation.id)).items[0]?.title).toBe('Новое имя');
    expect(await api.getEntry(task.id)).toEqual(task);
    expect((await api.getEntry(project.id))?.data).not.toHaveProperty(backlink.id);
    const before = await f.db.read((s) => s.query('SELECT id,hlc FROM record_versions'));
    await api.rebuildRelationIndex();
    expect(await f.db.read((s) => s.query('SELECT id,hlc FROM record_versions'))).toEqual(before);
    expect(
      await f.db.read((s) => s.query("SELECT payload FROM change_log WHERE entity_type='relation_index'"))
    ).toHaveLength(0);
  });
  it('validates cardinality, required lists, duplicates, target collection and library', async () => {
    const { api, projects, tasks, relation, many, backlink, project } = await setup();
    const elsewhere = await api.createLibrary('Другое'),
      other = await api.createCollection(elsewhere.id, 'Чужое', 'Название');
    const foreign = await api.saveEntry(other.id, { [other.primary_field_id]: 'Чужое' });
    await expect(
      api.createField(tasks.id, 'Нет', 'relation', { target_collection_id: other.id })
    ).rejects.toThrow('crossLibraryRelation');
    const data = { [tasks.primary_field_id]: 'A' };
    await expect(api.saveEntry(tasks.id, { ...data, [relation.id]: foreign.id })).rejects.toThrow(
      'relationTargetMismatch'
    );
    await expect(api.saveEntry(tasks.id, { ...data, [relation.id]: crypto.randomUUID() })).rejects.toThrow(
      'relationUnavailable'
    );
    await expect(api.saveEntry(tasks.id, { ...data, [relation.id]: [project.id] })).rejects.toThrow(
      'invalidRelation'
    );
    await expect(api.saveEntry(tasks.id, { ...data, [many.id]: [project.id, project.id] })).rejects.toThrow(
      'invalidRelation'
    );
    await api.updateField(many.id, {
      config: { target_collection_id: projects.id, multiple: true, required: true },
    });
    await expect(api.saveEntry(tasks.id, { ...data, [many.id]: [] })).rejects.toThrow('requiredField');
    await expect(
      api.saveEntry(projects.id, { [projects.primary_field_id]: 'A', [backlink.id]: [] })
    ).rejects.toThrow('readOnlyField');
    await expect(
      api.updateField(relation.id, { config: { target_collection_id: projects.id, multiple: true } })
    ).rejects.toThrow('relationDefinitionChange');
  });
  it('keeps deleted/missing targets, permits unrelated edits and restores link visibility', async () => {
    const { api, projects, tasks, relation, backlink, project } = await setup();
    const task = await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'A', [relation.id]: project.id });
    await api.setDeleted('record', project.id, true);
    expect((await api.getRelationPage(task.id, relation.id)).items[0]?.status).toBe('deleted');
    await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'B' }, task.id);
    await expect(
      api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'New', [relation.id]: project.id })
    ).rejects.toThrow('relationUnavailable');
    await api.setDeleted('record', project.id, false);
    expect((await api.getRelationPage(project.id, backlink.id)).items[0]?.id).toBe(task.id);
    // Simulate a record delivered before its target by future sync; rebuild never drops unknown UUIDs.
    const missing = crypto.randomUUID();
    await f.db.transaction((s) =>
      s.execute('UPDATE records SET data=json_set(data,?,?),relation_version=0 WHERE id=?', [
        '$."' + relation.id + '"',
        missing,
        task.id,
      ])
    );
    await api.rebuildRelationIndex(false);
    expect((await api.getRelationPage(task.id, relation.id)).items[0]).toMatchObject({
      id: missing,
      status: 'missing',
    });
    await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'C' }, task.id);
    expect((await api.getEntry(task.id))?.data[relation.id]).toBe(missing);
    await api.setDeleted('collection', projects.id, true);
    await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'D' }, task.id);
  });
  it('preserves multi-value order, pages both directions and maintains membership filters', async () => {
    const { api, projects, tasks, relation, many, backlink, project } = await setup();
    const second = await api.saveEntry(projects.id, { [projects.primary_field_id]: 'Другой' });
    const task = await api.saveEntry(tasks.id, {
      [tasks.primary_field_id]: 'A',
      [many.id]: [second.id, project.id],
    });
    const first = await api.getRelationPage(task.id, many.id, null, 1);
    expect(first.items[0]?.id).toBe(second.id);
    expect((await api.getRelationPage(task.id, many.id, first.next, 1)).items[0]?.id).toBe(project.id);
    for (let i = 0; i < 6; i++)
      await api.saveEntry(tasks.id, { [tasks.primary_field_id]: String(i), [relation.id]: project.id });
    const ids: string[] = [];
    let cursor: RelationCursor | null = null;
    do {
      const page = await api.getRelationPage(project.id, backlink.id, cursor, 2);
      ids.push(...page.items.map((r) => r.id));
      cursor = page.next;
    } while (cursor);
    expect(new Set(ids).size).toBe(6);
    expect(
      (
        await api.queryEntries({
          collection_id: tasks.id,
          filters: [{ field_id: many.id, op: 'eq', value: project.id }],
        })
      ).items.map((r) => r.id)
    ).toEqual([task.id]);
    expect(
      (
        await api.queryEntries({
          collection_id: projects.id,
          filters: [{ field_id: backlink.id, op: 'eq', value: ids[0]! }],
        })
      ).items.map((r) => r.id)
    ).toEqual([project.id]);
  });
  it('hides deleted sources/fields/collections and recovers edges and values on restore', async () => {
    const { api, projects, tasks, relation, backlink, project } = await setup();
    const task = await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'A', [relation.id]: project.id });
    for (const [kind, id] of [
      ['record', task.id],
      ['field', relation.id],
      ['collection', tasks.id],
    ] as const) {
      await api.setDeleted(kind, id, true);
      expect((await api.getRelationPage(project.id, backlink.id)).items).toHaveLength(0);
      await api.setDeleted(kind, id, false);
      expect((await api.getRelationPage(project.id, backlink.id)).items[0]?.id).toBe(task.id);
    }
    expect((await api.getEntry(task.id))?.data[relation.id]).toBe(project.id);
    await api.setDeleted('library', projects.library_id, true);
    await api.setDeleted('library', projects.library_id, false);
    expect((await api.getRelationPage(project.id, backlink.id)).items).toHaveLength(1);
  });
  it('creates linked records atomically from direct and reverse fields, leaving no orphans on failure', async () => {
    const { api, projects, tasks, relation, backlink, project } = await setup();
    const task = await api.createLinkedEntry(project.id, backlink.id, {
      [tasks.primary_field_id]: 'Из карточки',
    });
    expect(task.data[relation.id]).toBe(project.id);
    const created = await api.createLinkedEntry(task.id, relation.id, {
      [projects.primary_field_id]: 'Новый проект',
    });
    expect((await api.getEntry(task.id))?.data[relation.id]).toBe(created.id);
    const before = await f.db.read((s) => s.query('SELECT id,hlc FROM records ORDER BY id'));
    await expect(
      api.createLinkedEntry(task.id, relation.id, { [projects.primary_field_id]: '' })
    ).rejects.toThrow('requiredText');
    expect(await f.db.read((s) => s.query('SELECT id,hlc FROM records ORDER BY id'))).toEqual(before);
    await f.db.read((s) =>
      s.execute(
        "CREATE TRIGGER reject_edges BEFORE INSERT ON relation_index BEGIN SELECT RAISE(ABORT,'edge failure'); END"
      )
    );
    await expect(
      api.createLinkedEntry(project.id, backlink.id, { [tasks.primary_field_id]: 'Не сохранить' })
    ).rejects.toThrow('edge failure');
    expect(await f.db.read((s) => s.query('SELECT id,hlc FROM records ORDER BY id'))).toEqual(before);
  });
  it('rolls back edges, history, journal and HLC together when index writes fail', async () => {
    const { api, tasks, relation, project } = await setup();
    const row = await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'A' });
    const counts = () =>
      f.db.read((s) =>
        s.query(
          "SELECT (SELECT count(*) FROM record_versions) AS v,(SELECT count(*) FROM change_log) AS l,(SELECT value FROM local_settings WHERE key='hlc') AS h"
        )
      );
    const before = await counts();
    await f.db.read((s) =>
      s.execute(
        "CREATE TRIGGER reject_edges BEFORE INSERT ON relation_index BEGIN SELECT RAISE(ABORT,'edge failure'); END"
      )
    );
    await expect(api.saveEntry(tasks.id, { [relation.id]: project.id }, row.id)).rejects.toThrow(
      'edge failure'
    );
    expect(await counts()).toEqual(before);
    expect(await api.getEntry(row.id)).toEqual(row);
  });
  it('roundtrips raw UUIDs in CSV and exports computed backlinks without persisting them', async () => {
    const { api, projects, tasks, relation, many, backlink, project } = await setup();
    const task = await api.saveEntry(tasks.id, {
      [tasks.primary_field_id]: 'A',
      [relation.id]: project.id,
      [many.id]: [project.id],
    });
    const fields = await api.listFields(tasks.id);
    let text = '';
    const writer = {
      async write(s: string) {
        text += s;
      },
      async finish() {},
      async abort() {
        throw new Error('abort');
      },
    };
    await exportCsv(api, { collection_id: tasks.id }, fields, 'ru', ';', writer);
    expect(
      await api.importEntries(
        tasks.id,
        csvRecords(
          parseCsv(text),
          fields.map((f) => f.id),
          fields,
          'ru'
        )
      )
    ).toBe(1);
    text = '';
    await exportCsv(
      api,
      { collection_id: projects.id },
      await api.listFields(projects.id),
      'ru',
      ';',
      writer
    );
    const doc = parseCsv(text);
    expect(JSON.parse(doc.rows[0]![1]!)).toContain(task.id);
    expect((await api.getEntry(project.id))?.data).not.toHaveProperty(backlink.id);
  });
  it('uses forward/reverse indexes and resumes an interrupted rebuild after reopening', async () => {
    const { api, tasks, relation, project } = await setup();
    await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'A', [relation.id]: project.id });
    const plan = await f.db.read((s) =>
      s.query<{ detail: string }>(
        'EXPLAIN QUERY PLAN SELECT source_record_id FROM relation_index WHERE target_record_id=? AND field_id=?',
        [project.id, relation.id]
      )
    );
    expect(
      plan.some((r) => r.detail.includes('SEARCH') && /relations_reverse|relations_field/.test(r.detail))
    ).toBe(true);
    await f.db.transaction(async (s) => {
      await s.execute('DELETE FROM relation_index');
      await s.execute('UPDATE records SET relation_version=0');
    });
    await f.db.close();
    const db = await f.reopen();
    try {
      const reopened = await Repository.open(db);
      expect((await reopened.getRelationPage((await apiFromDb(db)).id, relation.id)).items).toHaveLength(1);
    } finally {
      await db.close();
    }
    async function apiFromDb(db: typeof f.db) {
      const rows = await db.read((s) =>
        s.query<{ id: string }>('SELECT id FROM records WHERE collection_id=?', [tasks.id])
      );
      return rows[0]!;
    }
  });
  it('rolls back a complete CSV-style import when a later batch references an unavailable target', async () => {
    const { api, tasks, relation, project } = await setup();
    const before = await f.db.read((s) => s.query('SELECT count(*) AS n FROM change_log'));
    const rows = Array.from({ length: 65 }, (_, i) => ({
      [tasks.primary_field_id]: String(i),
      [relation.id]: i === 64 ? crypto.randomUUID() : project.id,
    }));
    await expect(api.importEntries(tasks.id, rows)).rejects.toMatchObject({
      code: 'relationUnavailable',
      row: 66,
    });
    expect((await api.queryEntries({ collection_id: tasks.id })).items).toHaveLength(0);
    expect(await f.db.read((s) => s.query('SELECT * FROM relation_index'))).toHaveLength(0);
    expect(await f.db.read((s) => s.query('SELECT count(*) AS n FROM change_log'))).toEqual(before);
  });
  it('resolves a target arriving later without changing the source or rebuilding its edge', async () => {
    const { api, projects, tasks, relation, project } = await setup();
    const task = await api.saveEntry(tasks.id, { [tasks.primary_field_id]: 'A' }),
      missing = crypto.randomUUID();
    await f.db.transaction((s) =>
      s.execute('UPDATE records SET data=json_set(data,?,?),relation_version=0 WHERE id=?', [
        '$."' + relation.id + '"',
        missing,
        task.id,
      ])
    );
    await api.rebuildRelationIndex(false);
    const before = await api.getEntry(task.id);
    expect((await api.getRelationPage(task.id, relation.id)).items[0]?.status).toBe('missing');
    await f.db.transaction((s) =>
      s.execute(
        `INSERT INTO records(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,data,created_local,updated_local,purged,sort_data,search_data,sort_version,relation_version)
      SELECT ?,hlc,device_id,deleted_at,created_at,updated_at,collection_id,data,created_local,updated_local,purged,sort_data,search_data,sort_version,relation_version FROM records WHERE id=?`,
        [missing, project.id]
      )
    );
    expect((await api.getRelationPage(task.id, relation.id)).items[0]).toMatchObject({
      id: missing,
      status: 'available',
      collection_id: projects.id,
    });
    expect(await api.getEntry(task.id)).toEqual(before);
  });
});
