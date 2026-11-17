import { describe, expect, it } from 'vitest';
import { ciScope, validateNativeBaseline } from '../../scripts/ci-scope.mjs';

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
  it('permits explicit Android-only acceptance while full remains the default', () => {
    expect(ciScope({ name: 'workflow_dispatch' })).toMatchObject({ native: true, bridge: true, desktop: true, target: 'all' });
    expect(ciScope({ name: 'workflow_dispatch', target: 'android' })).toMatchObject({ native: true, bridge: false, desktop: false, target: 'android' });
    expect(ciScope({ name: 'workflow_dispatch', target: 'android', fullNative: false })).toMatchObject({ native: false, bridge: false, desktop: false });
    expect(() => ciScope({ name: 'workflow_dispatch', target: 'unknown' })).toThrow('Unsupported native target');
  });
  it('never narrows automatic native acceptance using an unrelated manual target', () => {
    expect(ciScope({ name: 'push', target: 'android' }, ['android/app/build.gradle'])).toMatchObject({ native: true, bridge: true, desktop: true, target: 'all' });
  });
  it('restricts resume to an explicit manual main/full/all request', () => {
    const event = { name: 'workflow_dispatch', ref: 'refs/heads/main', fullNative: true, target: 'all', resume: true };
    expect(ciScope(event)).toMatchObject({ native: true, bridge: true, desktop: true });
    for (const change of [{ name: 'push' }, { name: 'pull_request' }, { ref: 'refs/heads/other' }, { ref: undefined }, { fullNative: false }, { target: 'android' }]) {
      expect(() => ciScope({ ...event, ...change })).toThrow('Native resume requires');
    }
  });
});

describe('native continuation baseline', () => {
  const sha = 'a'.repeat(40), head = 'b'.repeat(40);
  const run = { status: 'completed', event: 'push', head_branch: 'main', repository: { full_name: 'Hemlig371/tessera' },
    head_repository: { full_name: 'Hemlig371/tessera' }, workflow_id: 123, path: '.github/workflows/ci.yml', head_sha: sha, conclusion: 'failure' };
  const jobs = ['scope', 'checks (ubuntu-24.04)', 'checks (windows-latest)', 'sync-foundation'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const context = { repository: 'Hemlig371/tessera', workflowId: 123, head, ancestor: true,
    files: ['src-tauri/src/replacement_store.rs', 'audit.md', 'README.md', '.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'tests/unit/ci-scope.test.mjs'] };
  it('reuses successful fast jobs from a failed run while rerunning every native job', () => {
    expect(validateNativeBaseline(run, [...jobs, { name: 'native-checks (windows-latest)', status: 'completed', conclusion: 'failure' }], context)).toBe(sha);
  });
  it.each([{ status: 'in_progress' }, { event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'other' },
    { repository: { full_name: 'other/repo' } }, { head_repository: { full_name: 'fork/tessera' } }, { workflow_id: 456 },
    { path: '.github/workflows/other.yml' }, { head_sha: 'invalid' }, { head_sha: head }])('rejects invalid baseline metadata %j', change => {
    expect(() => validateNativeBaseline({ ...run, ...change }, jobs, context)).toThrow('Baseline must');
  });
  it('rejects a non-ancestor and jobs that are missing, duplicate, unfinished, skipped, cancelled or failed', () => {
    expect(() => validateNativeBaseline(run, jobs, { ...context, ancestor: false })).toThrow('strict ancestor');
    for (let index = 0; index < jobs.length; index++) {
      expect(() => validateNativeBaseline(run, jobs.filter((_, n) => n !== index), context)).toThrow('not successful');
      expect(() => validateNativeBaseline(run, [...jobs, jobs[index]], context)).toThrow('not successful');
      for (const change of [{ status: 'in_progress' }, ...['skipped', 'cancelled', 'failure', null].map(conclusion => ({ conclusion }))]) {
        expect(() => validateNativeBaseline(run, jobs.map((job, n) => n === index ? { ...job, ...change } : job), context)).toThrow('not successful');
      }
    }
  });
  it.each(['src/ui/App.tsx', 'src/core/database-archive.ts', 'src/platform/tauri-database.ts', 'package.json', 'package-lock.json',
    'src-tauri/Cargo.lock', 'scripts/desktop-e2e.mjs', 'tests/support/android-main.tsx', 'tests/fixtures/README.md',
    'tests/db/database-archive.test.ts', 'android/app/build.gradle', '.github/workflows/other.yml', 'vite.config.ts'])('refuses to reuse checks after changing %s', path => {
    expect(() => validateNativeBaseline(run, jobs, { ...context, files: [...context.files, path] })).toThrow('does not cover changed paths');
  });
});
