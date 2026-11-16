import { attachmentScenario, attachmentFixture } from './attachments-scenario';
import { openBinaryFiles } from '../../src/platform/binary-files';
import { trashScenario } from './trash-scenario';
import { historyRestoreScenario, historyFixture } from './history-scenario';
import { createKnowledgeFixture } from '../fixtures/knowledge';
import { navigationFixture } from './navigation-scenario';
import { layoutScenario } from './layout-scenario';
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
import { quickScenario } from './quick-scenario';
import { openDraftStore } from '../../src/platform/local-files';
import { registerPlugin } from '@capacitor/core';
import { importCancellationScenario } from './import-cancellation-scenario';
import { markdownScenario } from './markdown-scenario';
import { presetsScenario } from './presets-scenario';
import { profilesScenario } from './profiles-scenario';
import { draftFixture } from './draft-fixture';

async function run() {
  const first = await openAndroidDatabase();
  document.documentElement.dataset.acceptanceStage = 'sqlite-contract';
  await sqliteContract(first);
  document.documentElement.dataset.acceptanceStage = 'migration';
  await migrate(first);
  const api = await Repository.open(first, openBinaryFiles());
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
  document.documentElement.dataset.acceptanceStage = 'attachments';
  await attachmentScenario(api);
  document.documentElement.dataset.attachmentFixture = JSON.stringify(await attachmentFixture(api));
  document.documentElement.dataset.acceptanceStage = 'trash';
  await trashScenario(api);
  document.documentElement.dataset.acceptanceStage = 'history';
  await historyRestoreScenario(api);
  document.documentElement.dataset.historyFixture = JSON.stringify(await historyFixture(api));
  document.documentElement.dataset.acceptanceStage = 'inbox';
  await inboxScenario(api);
  document.documentElement.dataset.acceptanceStage = 'quick';
  await quickScenario(api);
  document.documentElement.dataset.acceptanceStage = 'profiles';
  await profilesScenario(api);
  document.documentElement.dataset.acceptanceStage = 'presets';
  await presetsScenario(api);
  document.documentElement.dataset.acceptanceStage = 'import-cancellation';
  await importCancellationScenario(api);
  document.documentElement.dataset.acceptanceStage = 'knowledge';
  document.documentElement.dataset.navigationFixture = JSON.stringify(await navigationFixture(api));
  if (!(await api.listLibraries()).some(library => library.name === 'База знаний (dev/CI)')) await createKnowledgeFixture(api);
  document.documentElement.dataset.acceptanceStage = 'layout-rows';
  await layoutScenario(api);
  document.documentElement.dataset.acceptanceStage = 'markdown';
  await markdownScenario(api);
  const external = registerPlugin<{ openUrl(options: { url: string }): Promise<void> }>('ExternalActions');
  for (const url of ['javascript:alert(1)', 'file:///private', 'data:text/html,test']) {
    let rejected = false;
    try { await external.openUrl({ url }); } catch { rejected = true; }
    if (!rejected) throw new Error('native external scheme guard failed');
  }
  document.documentElement.dataset.acceptanceStage = 'reopen';
  await first.close();
  const reopened = await openAndroidDatabase();
  const again = await Repository.open(reopened, openBinaryFiles());
  document.documentElement.dataset.draftFixture = JSON.stringify(await draftFixture(again));
  if ((await again.getEntry(record.id))?.data[collection.primary_field_id] !== 'Bridge roundtrip') throw new Error('native reopen failed');
  document.documentElement.dataset.acceptanceStage = 'render';
  document.documentElement.dataset.acceptance = 'passed';
  createRoot(document.getElementById('root')!).render(<App api={again} drafts={await openDraftStore()}/>);
}
void run().catch((error: unknown) => {
  document.documentElement.dataset.acceptance = 'failed';
  document.documentElement.dataset.acceptanceError = String(error);
  document.body.textContent = String(error);
});
