// Dedicated acceptance APK entry. Production Vite config never references this file.
import { createRoot } from 'react-dom/client';
import '../../src/ui/i18n';
import '../../src/ui/style.css';
import { App } from '../../src/ui/App';
import { openAndroidDatabase } from '../../src/platform/android-database';
import { migrate } from '../../src/core/migrate';
import { Repository } from '../../src/core/repository';
import { sqliteContract } from './sqlite-contract';

async function run() {
  const first = await openAndroidDatabase();
  await sqliteContract(first); await migrate(first);
  const api = await Repository.open(first);
  const library = (await api.listLibraries()).find(l => l.name === 'Контракт') ?? await api.createLibrary('Контракт');
  const collection = (await api.listCollections(library.id))[0] ?? await api.createCollection(library.id, 'Записи', 'Название');
  const old = (await api.listEntries(collection.id)).items[0];
  const record = old ?? await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Bridge roundtrip' });
  await first.close();
  const reopened = await openAndroidDatabase();
  const again = await Repository.open(reopened);
  if ((await again.getEntry(record.id))?.data[collection.primary_field_id] !== 'Bridge roundtrip') throw new Error('native reopen failed');
  document.documentElement.dataset.acceptance = 'passed';
  createRoot(document.getElementById('root')!).render(<App api={again}/>);
}
void run().catch((error: unknown) => {
  document.documentElement.dataset.acceptance = 'failed';
  document.documentElement.dataset.acceptanceError = String(error);
  document.body.textContent = String(error);
});
