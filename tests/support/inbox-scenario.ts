import type { Repository } from '../../src/core/repository';

/** Runs through the real platform bridge in the acceptance APK. */
export async function inboxScenario(api: Repository) {
  const inbox = await api.getInbox();
  const library = await api.createLibrary('acceptance.inbox');
  const target = await api.createCollection(library.id, 'Inbox target', 'Title');
  const entry = await api.saveEntry(inbox.id, { [inbox.incoming_field_id]: 'Inbox bridge transfer' });
  let failed = false;
  try { await api.moveInboxEntry(entry.id, target.id, { [target.primary_field_id]: '' }, entry.hlc); }
  catch { failed = true; }
  if (!failed || (await api.getEntry(entry.id))?.collection_id !== inbox.id) throw new Error('inbox rollback failed');
  const moved = await api.moveInboxEntry(entry.id, target.id, {}, entry.hlc);
  if (moved.id !== entry.id || moved.created_at !== entry.created_at || moved.updated_at !== entry.updated_at ||
    (await api.queryEntries({ collection_id: inbox.id })).items.some(r => r.id === entry.id) ||
    !(await api.queryEntries({ collection_id: target.id, search: 'bridge' })).items.some(r => r.id === entry.id))
    throw new Error('inbox native transfer failed');
}
