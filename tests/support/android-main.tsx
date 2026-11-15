// Dedicated acceptance APK entry. Production Vite config never references this file.
import { createRoot } from 'react-dom/client';
import '../../src/ui/i18n';
import '../../src/ui/style.css';
import { App } from '../../src/ui/App';
import { openAndroidDatabase } from '../../src/platform/android-database';
import { migrate } from '../../src/core/migrate';
import { Repository } from '../../src/core/repository';
import { stage3Scenario } from './stage3-scenario';
import { stage2Scenario } from './stage2-scenario';
import { scaleScenario } from './scale';
import { sqliteContract } from './sqlite-contract';
import { inboxScenario } from './inbox-scenario';

async function run() {
  const first = await openAndroidDatabase();
  document.documentElement.dataset.acceptanceStage = 'sqlite-contract';
  await sqliteContract(first);
  document.documentElement.dataset.acceptanceStage = 'migration';
  await migrate(first);
  const api = await Repository.open(first);
  const library = (await api.listLibraries()).find(l => l.name === 'Контракт') ?? await api.createLibrary('Контракт');
  const collection = (await api.listCollections(library.id))[0] ?? await api.createCollection(library.id, 'Записи', 'Название');
  const old = (await api.listEntries(collection.id)).items[0];
  const record = old ?? await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Bridge roundtrip' });
  const [complete] = await first.read(s => s.query("SELECT value FROM local_settings WHERE key='acceptance.stage3'"));
  if (!complete) {
    document.documentElement.dataset.acceptanceStage = 'stage2';
    await stage2Scenario(api);
    document.documentElement.dataset.acceptanceStage = 'relations';
    await stage3Scenario(api);
    document.documentElement.dataset.acceptanceStage = 'scale';
    const result = await scaleScenario(api);
    document.documentElement.dataset.scale = JSON.stringify({ importMs: result.importMs, queryMs: result.queryMs });
    await first.transaction(s => s.execute("INSERT INTO local_settings VALUES('acceptance.stage3',?)", [JSON.stringify({ collection: result.collection.id, importMs: result.importMs, queryMs: result.queryMs })]));
  } else document.documentElement.dataset.scale = String(complete.value);
  document.documentElement.dataset.acceptanceStage = 'inbox';
  await inboxScenario(api);
  document.documentElement.dataset.acceptanceStage = 'reopen';
  await first.close();
  const reopened = await openAndroidDatabase();
  const again = await Repository.open(reopened);
  if ((await again.getEntry(record.id))?.data[collection.primary_field_id] !== 'Bridge roundtrip') throw new Error('native reopen failed');
  document.documentElement.dataset.acceptanceStage = 'render';
  document.documentElement.dataset.acceptance = 'passed';
  createRoot(document.getElementById('root')!).render(<App api={again}/>);
}
void run().catch((error: unknown) => {
  document.documentElement.dataset.acceptance = 'failed';
  document.documentElement.dataset.acceptanceError = String(error);
  document.body.textContent = String(error);
});
