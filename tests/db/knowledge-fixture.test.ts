import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { createKnowledgeFixture } from '../fixtures/knowledge';

describe.each(adapters)('%s universal knowledge library', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('keeps UUID relations through rename/delete/restore and supports paged Unicode search and finite cycle navigation', async () => {
    f = await fixture(kind); const api = f.api!, scope = await createKnowledgeFixture(api);
    const field = (await api.listFields(scope.collection_id)).find(item => item.name === 'Темы')!;
    const source = (await api.getEntry(scope.first))!, sourceVersions = await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=? ORDER BY id', [source.id]));
    const topic = (await api.getEntry(scope.topic))!, topics = await api.getCollection(scope.topics);
    await api.saveEntry(topics.id, { [topics.primary_field_id]: 'Архитектура переименована' }, topic.id, topic.hlc);
    expect((await api.getRelationPage(source.id, field.id)).items.find(item => item.id === topic.id)?.title).toBe('Архитектура переименована');
    await api.setDeleted('record', topic.id, true);
    expect((await api.getRelationPage(source.id, field.id)).items.find(item => item.id === topic.id)?.status).toBe('deleted');
    await api.setDeleted('record', topic.id, false);
    expect((await api.getRelationPage(source.id, field.id)).items.find(item => item.id === topic.id)?.status).toBe('available');
    expect(await api.getEntry(source.id)).toEqual(source);
    expect(await f.db.read(s => s.query('SELECT * FROM record_versions WHERE record_id=? ORDER BY id', [source.id]))).toEqual(sourceVersions);
    const first = await api.queryEntries({ collection_id: scope.collection_id, search: 'ЁЖ', limit: 200 });
    const second = await api.queryEntries({ collection_id: scope.collection_id, search: 'ЁЖ', limit: 200, cursor: first.next });
    expect(first.items.length + second.items.length).toBe(250); expect(second.next).toBeNull();
    expect((await api.getRelationPage(scope.first, scope.related)).items.map(item => item.id)).toEqual([scope.second]);
    expect((await api.getRelationPage(scope.second, scope.related)).items.map(item => item.id)).toEqual([scope.first]);
  });
});
