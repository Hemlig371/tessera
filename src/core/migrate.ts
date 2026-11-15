import type { DatabaseAdapter } from './ports';
import { AppError } from './errors';
import { bootstrapStatements, schemaId } from './schema';

async function checksum(): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bootstrapStatements.join('\n')));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
/** Pre-release bootstrap only. Existing unsupported databases are never upgraded or replaced. */
export async function migrate(db: DatabaseAdapter): Promise<void> {
  const expected = await checksum();
  await db.transaction(async s => {
    // android_metadata is owned by Android's SQLite runtime.
    const objects = await s.query<{ name: string; type: string }>(
      "SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>'android_metadata'");
    if (objects.length) {
      if (!objects.some(row => row.name === 'app_meta' && row.type === 'table') ||
          objects.some(row => row.name === 'schema_migrations')) throw new AppError('unsupportedSchema');
      let metadata;
      try { metadata = await s.query<{ key: string; value: string }>("SELECT key,value FROM app_meta WHERE key IN ('schema_id','schema_checksum','format_version')"); }
      catch { throw new AppError('unsupportedSchema'); }
      const values = new Map(metadata.map(row => [row.key, row.value]));
      if (values.get('schema_id') !== schemaId || values.get('schema_checksum') !== expected || values.get('format_version') !== '1')
        throw new AppError('unsupportedSchema');
      return;
    }
    for (const statement of bootstrapStatements) await s.execute(statement);
    await s.execute("INSERT INTO app_meta VALUES('schema_id',?),('schema_checksum',?),('format_version','1')", [schemaId, expected]);
  });
}
