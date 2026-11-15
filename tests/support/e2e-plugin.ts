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
      if (source === '../platform/csv-files' && importer?.endsWith('/src/ui/CsvPanel.tsx'))
        return resolve('tests/support/csv-files-e2e.ts');
      if (source === './platform/open' && importer?.endsWith('/src/main.tsx'))
        return resolve('tests/support/open-e2e.ts');
      if (source === './platform/local-files' && importer?.endsWith('/src/main.tsx'))
        return resolve('tests/support/local-files-e2e.ts');
    },
    async configureServer(server) {
      directory = await mkdtemp(resolve(tmpdir(), 'tessera-e2e-'));
      db = await openNodeDatabase(resolve(directory, 'app.sqlite'));
      server.httpServer?.on('close', () => {
        void cleanup();
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
          } = JSON.parse(body) as { op: string; sql: string; params?: SqlValue[]; path?: string; bytes?: number[] };
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
          if (op === 'quick-seed') {
            const fixture = await quickFormFixture(await Repository.open(db));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ value: fixture.library.id }));
            return;
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
