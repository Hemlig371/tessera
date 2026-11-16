import { describe, expect, it } from 'vitest';
import { ciScope } from '../../scripts/ci-scope.mjs';

describe('CI scope', () => {
  it('keeps ordinary product/documentation changes on the fast checks', () => {
    expect(ciScope({ name: 'push' }, ['src/ui/App.tsx', 'src/core/repository.ts', 'tests/db/secret-search.test.ts', 'README.md']).native).toBe(false);
    expect(ciScope({ name: 'pull_request' }, ['android/README.md', 'tests/fixtures/README.md']).native).toBe(false);
  });
  it.each(['android/app/build.gradle', 'src-tauri/src/local_files.rs', 'src/platform/android-database.ts', 'src/core/schema.ts',
    'src/core/ports.ts', 'package-lock.json', '.github/workflows/ci.yml', 'tests/native/storage-crash.test.ts',
    'tests/support/history-scenario.ts', 'scripts/run-android-tests.mjs', 'vitest.config.ts', 'vite.config.ts', 'tsconfig.json'])('requires native acceptance for %s', path => {
    expect(ciScope({ name: 'push' }, [path]).native).toBe(true);
  });
  it('preserves full manual CI by default and explicit checkpoints without requiring a native path', () => {
    expect(ciScope({ name: 'push', tag: true }, ['README.md']).native).toBe(true);
    expect(ciScope({ name: 'workflow_dispatch' }).native).toBe(true);
    expect(ciScope({ name: 'workflow_dispatch', fullNative: false }).native).toBe(false);
    expect(ciScope({ name: 'push', message: 'feat: complete subsystem [native ci]' }, []).native).toBe(true);
    expect(ciScope({ name: 'push', message: 'test: checkpoint [full ci]' }, ['src/ui/App.tsx']).native).toBe(true);
    expect(() => ciScope({ name: 'unknown' })).toThrow('Unsupported CI event');
  });
});
