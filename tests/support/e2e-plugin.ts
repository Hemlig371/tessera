import { migrate } from '../../src/core/migrate';
import { attachmentFixture } from './attachments-scenario';
import { createReadStream } from 'node:fs';
import { nodeBinaryFiles } from './node-binary-files';
import { historyFixture } from './history-scenario';
import { createKnowledgeFixture } from '../fixtures/knowledge';
import { layoutScenario } from './layout-scenario';
import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import { mkdtemp, rm, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { openNodeDatabase } from './node-database';
import { Repository } from '../../src/core/repository';
import { stage3Scenario } from './stage3-scenario';
import { scaleScenario } from './scale';
import { quickFormFixture } from './quick-scenario';
import { markdownScenario } from './markdown-scenario';
import { presetsScenario } from './presets-scenario';
import { profilesScenario } from './profiles-scenario';
import { draftFixture } from './draft-fixture';
import type { SqlValue } from '../../src/core/ports';

/** Explicit test-only HTTP harness with real SQLite; absent from production config. */
export function e2ePlugin(): Plugin {
  let db: Awaited<ReturnType<typeof openNodeDatabase>>;
  let directory: string;
  let cleaning: Promise<void> | undefined;
  const cleanup = () =>
    (cleaning ??= (async () => {
      if (db) await db.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    })());
  return {
    closeBundle: cleanup,
    name: 'tessera-e2e-native-sqlite',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../platform/external-actions' && importer?.endsWith('/src/ui/MarkdownView.tsx')) return resolve('tests/support/external-actions-e2e.ts');
      if (source === '../platform/database-import' && importer?.endsWith('/src/ui/DatabaseArchive.tsx')) return resolve('tests/support/database-import-e2e.ts');
      if (source === '../platform/csv-files' && (importer?.endsWith('/src/ui/CsvPanel.tsx') || importer?.endsWith('/src/ui/DatabaseArchive.tsx')))
        return resolve('tests/support/csv-files-e2e.ts');
      if (source === './platform/binary-files' && importer?.endsWith('/src/main.tsx')) return resolve('tests/support/binary-files-e2e.ts');
      if (source === './platform/open' && importer?.endsWith('/src/main.tsx'))
        return resolve('tests/support/open-e2e.ts');
      if (source === './platform/local-files' && importer?.endsWith('/src/main.tsx'))
        return resolve('tests/support/local-files-e2e.ts');
    },
    async configureServer(server) {
      directory = await mkdtemp(resolve(tmpdir(), 'tessera-e2e-'));
      db = await openNodeDatabase(resolve(directory, 'app.sqlite'));
      // Existing UI scenarios start with an established installation. The archive scenario resets explicitly.
      await migrate(db); await Repository.open(db);
      server.httpServer?.on('close', () => {
        void cleanup();
      });
      const files = nodeBinaryFiles(directory), exports = new Map<string, string>();
      const stagePath = directory + '-import';
      let stageDb: Awaited<ReturnType<typeof openNodeDatabase>> | null = null;
      const stageFiles = nodeBinaryFiles(stagePath);
      server.middlewares.use('/__test-archive', async (req, res) => {
        if (req.method !== 'POST' || (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:1420')) { res.statusCode = 403; res.end(); return; }
        try {
          let text = ''; for await (const chunk of req) { text += String(chunk); if (text.length > 1_000_000) throw new Error('request too large'); }
          const args = JSON.parse(text) as { op: string; sql: string; params?: SqlValue[]; id: string; offset: number; data: string; size: number; sha256: string };
          let value: unknown = null;
          if (args.op === 'seed') {
            const api = await Repository.open(db, files), library = await api.createLibrary('Архив ' + crypto.randomUUID().slice(0,8));
            const collection = await api.createCollection(library.id, 'Данные', 'Название'), field = await api.createField(collection.id, 'Файл', 'file');
            const owner = crypto.randomUUID(), contents = new Uint8Array([0,255,17,99]);
            const staged = await api.stageAttachment(collection.id, owner, { name: 'Тест.bin', mime: 'application/octet-stream', size: contents.length, read: async (offset, size) => contents.slice(offset, offset + size) });
            const entry = await api.saveNewEntry(collection.id, { [collection.primary_field_id]: 'До экспорта', [field.id]: [staged.id] }, owner);
            value = { id: entry.id, hlc: entry.hlc, collection_id: collection.id, field_id: collection.primary_field_id, attachment: staged.id, device_id: api.deviceId, dataset_id: api.datasetId };
          }
          else if (args.op === 'reset') { await db.close(); await rm(directory, { recursive: true, force: true }); db = await openNodeDatabase(resolve(directory, 'app.sqlite')); }
          else if (args.op === 'prepare') { await stageDb?.close(); await rm(stagePath, { recursive: true, force: true }); stageDb = await openNodeDatabase(resolve(stagePath, 'app.sqlite')); }
          else if (args.op === 'close') { await stageDb?.close(); stageDb = null; }
          else if (args.op === 'abort') { await stageDb?.close(); stageDb = null; await rm(stagePath, { recursive: true, force: true }); }
          else if (args.op === 'activate') {
            await db.close(); await stageDb?.close(); stageDb = null;
            const old = directory + '-old'; await rm(old, { recursive: true, force: true });
            await rename(directory, old); await rename(stagePath, directory); await rm(old, { recursive: true, force: true });
            db = await openNodeDatabase(resolve(directory, 'app.sqlite'));
          } else if (args.op === 'file-begin') await stageFiles.begin(args.id);
          else if (args.op === 'file-write') await stageFiles.write(args.id, args.offset, Buffer.from(args.data, 'base64'));
          else if (args.op === 'file-finish') value = await stageFiles.finish(args.id, args.size, args.sha256);
          else value = await stageDb!.read(async s => {
            if (args.op === 'query') return s.query(args.sql, args.params);
            if (args.op === 'execute') return s.execute(args.sql, args.params);
            if (args.op === 'begin') return s.begin(); if (args.op === 'commit') return s.commit(); if (args.op === 'rollback') return s.rollback();
            throw new Error('invalid stage operation');
          });
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value }));
        } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'fileError' })); }
      });
      server.httpServer?.on('close', () => { void Promise.resolve(stageDb?.close()).then(() => rm(stagePath, { recursive: true, force: true })); });
      server.middlewares.use('/__test-file-export', (req, res) => {
        const id = new URL(req.url ?? '', 'http://127.0.0.1:1420').searchParams.get('id'), name = id ? exports.get(id) : null;
        if (!id || !name || req.method !== 'GET') { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
        const stream = createReadStream(resolve(directory, 'exports', id)); stream.on('error', () => { res.statusCode = 500; res.end(); }); stream.pipe(res);
      });
      server.middlewares.use('/__test-sqlite', async (req, res) => {
        // Bound to loopback; reject cross-origin requests. Never shipped in application.
        if (req.method !== 'POST' || (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:1420')) {
          res.statusCode = 403;
          res.end();
          return;
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 1_000_000) throw new Error('request too large');
          }
          const {
            op,
            sql,
            params = [],
            path,
            bytes,
            file,
          } = JSON.parse(body) as { op: string; sql: string; params?: SqlValue[]; path?: string; bytes?: number[]; file?: { id: string; offset: number; data: string; size: number; sha256?: string; length: number; staged: boolean; name: string; mime: string } };
          if (op.startsWith('binary-')) {
            if (!file) throw new Error('fileError');
            let value: unknown;
            switch (op) {
              case 'binary-begin': value = await files.begin(file.id); break;
              case 'binary-write': value = await files.write(file.id, file.offset, Buffer.from(file.data, 'base64')); break;
              case 'binary-finish': value = await files.finish(file.id, file.size, file.sha256); break;
              case 'binary-stat': value = await files.stat(file.id); break;
              case 'binary-inspect': value = await files.inspect(file.id); break;
              case 'binary-read': value = Buffer.from(await files.read(file.id, file.offset, file.length)).toString('base64'); break;
              case 'binary-remove': value = await files.remove(file.id, file.staged); break;
              case 'binary-export': value = await files.export(file.id, file.name, file.mime, { size: file.size, sha256: file.sha256! }); exports.set(file.id, file.name); break;
              default: throw new Error('fileError');
            }
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value: value ?? null })); return;
          }
          if (op.startsWith('local-')) {
            if (!path || path.split('/').some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) throw new Error('fileError');
            const target = resolve(directory, 'operational', path);
            let value: number[] | null = null;
            if (op === 'local-read') {
              try { value = [...await readFile(target)]; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            } else if (op === 'local-write') {
              await mkdir(dirname(target), { recursive: true });
              const temp = target + '.' + crypto.randomUUID();
              await writeFile(temp, new Uint8Array(bytes!)); await rename(temp, target);
            } else if (op === 'local-remove') await rm(target, { force: true });
            else throw new Error('fileError');
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'cleanup') {
            await cleanup();
            res.setHeader('Content-Type', 'application/json');
            res.end('{"value":null}');
            return;
          }
          if (op === 'relation-page-seed') {
            const api = await Repository.open(db),
              fixture = await stage3Scenario(api);
            await api.importEntries(
              fixture.projects.id,
              Array.from({ length: 51 }, (_, i) => ({ [fixture.projects.primary_field_id]: 'Цель ' + i }))
            );
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ value: fixture.library.id }));
            return;
          }
          if (op === 'history-concurrent-edit') {
            const api = await Repository.open(db), entry = await api.getEntry(String(params[0]));
            if (!entry) throw new Error('notFound');
            const collection = await api.getCollection(entry.collection_id);
            const value = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Конкурентная правка' }, entry.id, entry.hlc);
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'attachment-seed') {
            const value = await attachmentFixture(await Repository.open(db, files));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'attachment-corrupt') {
            const id = String(params[0]);
            if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalidId');
            await writeFile(resolve(directory, 'attachments', id.slice(0,2), id), new Uint8Array([4,3,2,1]));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value: true })); return;
          }
          if (op === 'history-seed') {
            const value = await historyFixture(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'quick-seed') {
            const fixture = await quickFormFixture(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ value: fixture.library.id }));
            return;
          }
          if (op === 'knowledge-seed') {
            const value = await createKnowledgeFixture(await Repository.open(db), typeof params[0] === 'string' ? params[0] : undefined);
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'navigation-seed') {
            const api = await Repository.open(db);
            const scope = await createKnowledgeFixture(api, typeof params[0] === 'string' ? params[0] : 'Навигация (dev/CI)');
            const profile = await api.createDisplayProfile(scope.collection_id, 'Стартовый профиль', await api.getUiConfig(scope.collection_id, 'list'));
            const value = { ...scope, profile_id: profile.id };
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'navigation-delete-profile') {
            await (await Repository.open(db)).deleteDisplayProfile(String(params[0]));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value: true })); return;
          }
          if (op === 'layout-seed') {
            const value = await layoutScenario(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'markdown-seed') {
            const value = await markdownScenario(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'inbox-context') {
            const value = await (await Repository.open(db)).getInbox();
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'presets-seed') {
            const value = await presetsScenario(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'profiles-seed') {
            const value = await profilesScenario(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'draft-recovery-seed') {
            const api = await Repository.open(db), library = await api.createLibrary('Восстановление черновика (dev/CI) ' + crypto.randomUUID().slice(0, 8));
            const collection = await api.createCollection(library.id, 'Записи', 'Название');
            const value = { dataset_id: api.datasetId, library_id: library.id, library_name: library.name, collection_id: collection.id, primary_field_id: collection.primary_field_id };
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'draft-seed') {
            const value = await draftFixture(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'draft-existing') {
            const api = await Repository.open(db), parent = await api.getCollection(String(params[0]));
            const value = await api.saveEntry(parent.id, { [parent.primary_field_id]: 'Существующая заметка' });
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          if (op === 'stale-update') {
            const api = await Repository.open(db), entry = (await api.getEntry(String(params[0])))!;
            const parent = await api.getCollection(entry.collection_id);
            const value = await api.saveEntry(parent.id, { [parent.primary_field_id]: String(params[1]) }, entry.id, entry.hlc);
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); return;
          }
          const result =
            op === 'scale'
              ? await scaleScenario(await Repository.open(db)).then((r) => ({
                  importMs: r.importMs,
                  queryMs: r.queryMs,
                }))
              : await db.read(async (s) => {
                  if (op === 'query') return s.query(sql, params);
                  if (op === 'execute') return s.execute(sql, params);
                  if (op === 'begin') return s.begin();
                  if (op === 'commit') return s.commit();
                  if (op === 'rollback') return s.rollback();
                  if (op === 'backup') return s.backup();
                  throw new Error('unknown test operation');
                });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ value: result ?? null }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'test bridge failed' }));
        }
      });
    },
  };
}
