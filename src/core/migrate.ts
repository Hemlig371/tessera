import type { DatabaseAdapter } from './ports';
import { AppError } from './errors';
import { migrations } from './schema';

async function checksum(statements: readonly string[]) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(statements.join('\n')));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function migrate(db: DatabaseAdapter): Promise<void> {
  const applied = await db.read(async s => {
    const tables = await s.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    if (!tables.some(t => t.name === 'schema_migrations')) {
      if (tables.length) throw new AppError('unsupportedSchema');
      return [];
    }
    return s.query<{ version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version');
  });
  for (const [index, row] of applied.entries()) {
    const known = migrations[index];
    if (!known || row.version !== known.version || row.checksum !== await checksum(known.statements)) throw new AppError('unsupportedSchema');
  }
  const pending = migrations.filter(m => !applied.some(a => a.version === m.version));
  if (!pending.length) return;
  // VACUUM INTO / native backup uses a separate, consistent file, including WAL contents.
  await db.backup();
  await db.transaction(async s => {
    await s.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    for (const m of pending) {
      for (const statement of m.statements) await s.execute(statement);
      await s.execute('INSERT INTO schema_migrations VALUES(?,?,?)', [m.version, await checksum(m.statements), new Date().toISOString()]);
    }
    await s.execute("INSERT INTO app_meta(key,value) VALUES('format_version','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  });
}
