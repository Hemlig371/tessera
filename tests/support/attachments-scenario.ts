import type { Repository } from '../../src/core/repository';
/** Universal fields and API only; isolated from production and all other acceptance data. */
export async function attachmentFixture(api: Repository) {
  const library = await api.createLibrary('Вложения (dev/CI) ' + crypto.randomUUID().slice(0,8));
  const collection = await api.createCollection(library.id, 'Материалы с файлами', 'Название');
  const file = await api.createField(collection.id, 'Документы', 'file', { multiple: true });
  const image = await api.createField(collection.id, 'Фото', 'image');
  return { library_id: library.id, library_name: library.name, collection_id: collection.id, field_id: collection.primary_field_id, file_id: file.id, image_id: image.id };
}
export async function attachmentScenario(api: Repository) {
  const fixture = await attachmentFixture(api), owner = crypto.randomUUID();
  const bytes = new Uint8Array([0,255,17,13,10,42]);
  const source = { name: 'Native — документ.bin', mime: 'application/octet-stream', size: bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length) };
  const staged = await api.stageAttachment(fixture.collection_id, owner, source);
  let entry = await api.saveNewEntry(fixture.collection_id, { [fixture.field_id]: 'Файл через bridge', [fixture.file_id]: [staged.id] }, owner);
  const version = (await api.getHistory(owner)).versions[0]!;
  entry = await api.saveEntry(fixture.collection_id, { [fixture.file_id]: [] }, owner, entry.hlc);
  entry = await api.restoreEntryVersion(owner, version.id, entry.hlc);
  if (entry.data[fixture.file_id]?.toString() !== staged.id || (await api.getAttachmentView(staged.id, owner, true)).status !== 'present') throw new Error('native attachment binding/history failed');
  await api.removeAttachmentCopy(staged.id, owner, true);
  if ((await api.getAttachmentView(staged.id, owner)).status !== 'missing') throw new Error('native attachment removal failed');
  await api.restoreAttachmentCopy(staged.id, owner, source);
  if ((await api.getAttachmentView(staged.id, owner, true)).status !== 'present') throw new Error('native attachment copy verification failed');
  await api.setDeleted('record', owner, true);
  await api.purgeEntry(owner, (await api.queryTrash(fixture.library_id)).items[0]!.hlc);
  if ((await api.collectAttachmentFiles()).pending || (await api.getHistory(owner)).versions.length) throw new Error('native attachment purge failed');
}
