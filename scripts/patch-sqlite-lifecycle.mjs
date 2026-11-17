import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Pinned upstream 8.1.1 omits Activity/WebView connection disposal. Never rely on JS unload.
const root = resolve('node_modules/@capacitor-community/sqlite');
const pkg = JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
if (pkg.version !== '8.1.1') throw new Error('Review the SQLite lifecycle patch before changing the native dependency');
const base = resolve(root,'android/src/main/java/com/getcapacitor/community/database/sqlite');
const patches = [
  {
    path: resolve(base,'CapacitorSQLitePlugin.java'), hash: '36e5395cec122a02ec1372c29d9578e08cd4b013b0ecdf05cab74b213ac65bb7',
    before: 'public class CapacitorSQLitePlugin extends Plugin {',
    after: `public class CapacitorSQLitePlugin extends Plugin {
    // Tessera: dispose this WebView's connections on the SQLite owner thread.
    @Override protected void handleOnDestroy() {
        getBridge().execute(() -> {
            if (implementation == null) return;
            try {
                implementation.checkConnectionsConsistency(new JSArray(), new JSArray());
            } catch (Exception error) {
                Log.e(TAG, "SQLite lifecycle cleanup failed", error);
            }
        });
    }`,
  },
  {
    path: resolve(base,'SQLite/Database.java'), hash: 'd17cdd1d021cf5475713946535e833d4d78cd4ed78b219c0e5ac6da917d6cc50',
    before: '    public void close() throws Exception {\n        if (_db.isOpen()) {\n            try {\n                _db.close();',
    after: '    public void close() throws Exception {\n        if (_db.isOpen()) {\n            try {\n                // Tessera: an abandoned renderer transaction must roll back before pool close.\n                while (_db.inTransaction()) _db.endTransaction();\n                _db.close();',
  },
];
const sha = text => createHash('sha256').update(text).digest('hex');
for (const patch of patches) {
  const source = await readFile(patch.path,'utf8');
  if (source.includes(patch.after) && sha(source.replace(patch.after,patch.before)) === patch.hash) continue;
  if (sha(source) !== patch.hash || source.split(patch.before).length !== 2) throw new Error('Unexpected upstream SQLite source: '+patch.path);
  await writeFile(patch.path,source.replace(patch.before,patch.after));
}
console.log('Verified Android SQLite lifecycle patch applied (8.1.1).');
