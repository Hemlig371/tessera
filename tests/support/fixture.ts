import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDatabase } from './node-database';
import { openRustDatabase } from './rust-database';
import { checkSqlite } from '../../src/core/sqlite-check';
import { migrate } from '../../src/core/migrate';
import { nodeBinaryFiles } from './node-binary-files';
import { Repository } from '../../src/core/repository';

export const adapters = process.env.TESSERA_RUST_BRIDGE ? ['node', 'rust'] as const : ['node'] as const;
export async function fixture(kind: 'node' | 'rust' = 'node', initialize = true) {
  const directory = await mkdtemp(join(tmpdir(), 'tessera-test-'));
  const path = join(directory, 'app.sqlite');
  const reopen = async () => kind === 'node' ? openNodeDatabase(path) : openRustDatabase(process.env.TESSERA_RUST_BRIDGE!, path);
  const db = await reopen(), files = nodeBinaryFiles(directory);
  if (initialize) { await checkSqlite(db); await migrate(db); }
  return { db, files, directory, path, reopen,
    api: initialize ? await Repository.open(db, files) : null,
    cleanup: async () => { await db.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
