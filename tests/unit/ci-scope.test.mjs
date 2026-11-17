import { describe, expect, it } from 'vitest';
import { ciScope, validateNativeBaseline, validateAndroidContinuation, validatePriorityBaseline, normalizePriorityUiTest, validatePriorityAndroidNative } from '../../scripts/ci-scope.mjs';

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
  it('restricts resume to an explicit manual main/full request', () => {
    const event = { name: 'workflow_dispatch', ref: 'refs/heads/main', fullNative: true, target: 'all', resume: true };
    expect(ciScope(event)).toMatchObject({ native: true, bridge: true, desktop: true });
    expect(ciScope({ ...event, target: 'android' })).toMatchObject({ native: true, bridge: false, desktop: false });
    for (const change of [{ name: 'push' }, { name: 'pull_request' }, { ref: 'refs/heads/other' }, { ref: undefined }, { fullNative: false }]) {
      expect(() => ciScope({ ...event, ...change })).toThrow('Native resume requires');
    }
  });
  it('selects only pending Linux desktop and Android jobs after verified resume', () => {
    const event = { name: 'workflow_dispatch', ref: 'refs/heads/main', fullNative: true, target: 'linux_android', resume: true };
    expect(ciScope(event)).toMatchObject({ native: true, bridge: false, desktop: true, desktopMatrix: [
      { os: 'ubuntu-24.04', target: 'x86_64-unknown-linux-gnu', artifact: 'linux-x64', bundles: 'appimage' },
    ] });
    expect(() => ciScope({ ...event, resume: false })).toThrow('require verified resume');
    expect(ciScope({ name: 'workflow_dispatch' }).desktopMatrix.map(job => job.os)).toEqual(['windows-latest', 'macos-15', 'ubuntu-24.04']);
    expect(ciScope({ name: 'push', target: 'linux_android' }, ['src-tauri/src/main.rs'])).toMatchObject({ bridge: true, desktop: true, target: 'all' });
  });
});

describe('native continuation baseline', () => {
  const sha = 'a'.repeat(40), head = 'b'.repeat(40);
  const run = { status: 'completed', event: 'push', head_branch: 'main', repository: { full_name: 'Hemlig371/tessera' },
    head_repository: { full_name: 'Hemlig371/tessera' }, workflow_id: 123, path: '.github/workflows/ci.yml', head_sha: sha, conclusion: 'failure' };
  const jobs = ['scope', 'checks (ubuntu-24.04)', 'checks (windows-latest)', 'sync-foundation'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const context = { repository: 'Hemlig371/tessera', workflowId: 123, head, ancestor: true,
    files: ['src-tauri/src/replacement_store.rs', 'audit.md', 'README.md', 'tests/fixtures/README.md', '.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'tests/unit/ci-scope.test.mjs'] };
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
    'src-tauri/Cargo.lock', 'scripts/desktop-e2e.mjs', 'tests/support/android-main.tsx', 'tests/fixtures/notes.ts', 'tests/fixtures/new.md',
    'tests/db/database-archive.test.ts', 'android/app/build.gradle', '.github/workflows/other.yml', 'vite.config.ts'])('refuses to reuse checks after changing %s', path => {
    expect(() => validateNativeBaseline(run, jobs, { ...context, files: [...context.files, path] })).toThrow('does not cover changed paths');
  });
  it.each(['ImportFilesPlugin.kt', 'ReplacementStore.kt'])('allows the Android import fix %s only for Android continuation', name => {
    const changed = { ...context, files: [...context.files, 'android/app/src/main/java/app/tessera/personal/' + name] };
    expect(() => validateNativeBaseline(run, jobs, changed)).toThrow('does not cover');
    expect(validateNativeBaseline(run, jobs, { ...changed, target: 'android' })).toBe(sha);
  });
  it('permits desktop test repair only when Linux desktop will run again', () => {
    const changed = { ...context, files: [...context.files, 'scripts/desktop-e2e.mjs'] };
    expect(() => validateNativeBaseline(run, jobs, { ...changed, target: 'android' })).toThrow('does not cover');
    expect(validateNativeBaseline(run, jobs, { ...changed, target: 'linux_android' })).toBe(sha);
  });
});

describe('Android continuation requires separate desktop/native evidence', () => {
  const sha = 'c'.repeat(40), head = 'd'.repeat(40);
  const run = { status: 'completed', event: 'workflow_dispatch', head_branch: 'main', repository: { full_name: 'Hemlig371/tessera' },
    head_repository: { full_name: 'Hemlig371/tessera' }, workflow_id: 123, path: '.github/workflows/ci.yml', head_sha: sha, conclusion: 'failure' };
  const jobs = ['scope', 'native-checks (ubuntu-24.04)', 'native-checks (windows-latest)',
    'desktop (windows-latest, x86_64-pc-windows-msvc, windows-x64, nsis)', 'desktop (macos-15, aarch64-apple-darwin, macos-arm64, dmg)',
    'desktop (ubuntu-24.04, x86_64-unknown-linux-gnu, linux-x64, appimage)'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const context = { repository: 'Hemlig371/tessera', workflowId: 123, head, ancestor: true,
    files: ['android/app/src/main/java/app/tessera/personal/ImportFilesPlugin.kt', 'android/app/src/main/java/app/tessera/personal/ReplacementStore.kt',
      '.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'tests/unit/ci-scope.test.mjs', 'audit.md', 'README.md'] };
  it('accepts a failed Android run only if every desktop/native job passed', () => {
    expect(validateAndroidContinuation(run, [...jobs, { name: 'android-apk', status: 'completed', conclusion: 'failure' }], context)).toBe(sha);
  });
  it('rejects missing, skipped, failed, duplicate or unfinished native evidence', () => {
    for (let index = 0; index < jobs.length; index++) {
      expect(() => validateAndroidContinuation(run, jobs.filter((_, n) => n !== index), context)).toThrow('not successful');
      expect(() => validateAndroidContinuation(run, [...jobs, jobs[index]], context)).toThrow('not successful');
      for (const change of [{ status: 'in_progress' }, ...['skipped', 'cancelled', 'failure', null].map(conclusion => ({ conclusion }))]) {
        expect(() => validateAndroidContinuation(run, jobs.map((job, n) => n === index ? { ...job, ...change } : job), context)).toThrow('not successful');
      }
    }
  });
  it.each([{ status: 'in_progress' }, { event: 'pull_request' }, { head_branch: 'other' }, { repository: { full_name: 'fork/tessera' } },
    { head_repository: { full_name: 'fork/tessera' } }, { workflow_id: 456 }, { path: 'other.yml' }, { head_sha: head }, { head_sha: 'invalid' }])('rejects invalid native metadata %j', change => {
    expect(() => validateAndroidContinuation({ ...run, ...change }, jobs, context)).toThrow('completed native ancestor');
  });
  it('rejects a non-ancestor and any other code changes, including another Rust change', () => {
    expect(() => validateAndroidContinuation(run, jobs, { ...context, ancestor: false })).toThrow('completed native ancestor');
    for (const path of ['src-tauri/src/replacement_store.rs', 'src/ui/App.tsx', 'package-lock.json', 'scripts/desktop-e2e.mjs', 'android/app/build.gradle']) {
      expect(() => validateAndroidContinuation(run, jobs, { ...context, files: [...context.files, path] })).toThrow('inputs changed');
    }
  });
  it('permits a failed Linux test only when that desktop job runs again', () => {
    const failed = jobs.map(job => job.name.startsWith('desktop (ubuntu') ? { ...job, conclusion: 'failure' } : job);
    const changed = { ...context, files: [...context.files, 'scripts/desktop-e2e.mjs'] };
    expect(() => validateAndroidContinuation(run, failed, changed)).toThrow('not successful');
    expect(() => validateAndroidContinuation(run, jobs, changed)).toThrow('inputs changed');
    expect(validateAndroidContinuation(run, failed, { ...changed, target: 'linux_android' })).toBe(sha);
    for (const name of ['native-checks (windows-latest)', 'native-checks (ubuntu-24.04)', 'desktop (macos-15, aarch64-apple-darwin, macos-arm64, dmg)', 'desktop (windows-latest, x86_64-pc-windows-msvc, windows-x64, nsis)']) {
      expect(() => validateAndroidContinuation(run, failed.map(job => job.name === name ? { ...job, conclusion: 'failure' } : job), { ...changed, target: 'linux_android' })).toThrow('not successful');
    }
  });
});


describe('user-directed priority native continuation', () => {
  const repository = 'owner/repo',sha = 'a'.repeat(40),head = 'b'.repeat(40);
  const run = { status: 'completed',event: 'workflow_dispatch',head_branch: 'main',repository: { full_name: repository },head_repository: { full_name: repository },workflow_id: 123,path: '.github/workflows/ci.yml',head_sha: sha };
  const passed = name => ({ name,status: 'completed',conclusion: 'success' });
  const steps = ['typecheck','check:platforms','lint','licenses','test:unit','test:db','test:e2e','build'].map(command => passed('Run npm run '+command));
  const jobs = [passed('scope'),{ ...passed('checks (windows-latest)'),steps: [...steps,passed('Windows smoke cleanup regression')] },{ ...passed('sync-foundation'),steps: [passed('Run npm run test:sync')] },{ name: 'checks (ubuntu-24.04)',status: 'completed',conclusion: 'failure' }];
  const context = { repository,workflowId: 123,head,ancestor: true,files: ['AGENTS.md','audit.md','tests/support/e2e-test.ts'] };
  it('selects Android, Windows native and Windows/macOS desktop without Linux application jobs', () => {
    const scope = ciScope({ name: 'workflow_dispatch',target: 'priority',ref: 'refs/heads/main',resume: true });
    expect(scope).toMatchObject({ native: true,bridge: true,desktop: true,checkMatrix: ['windows-latest'],bridgeMatrix: ['windows-latest'] });
    expect(scope.desktopMatrix.map(job => job.os)).toEqual(['windows-latest','macos-15']);
    expect(validatePriorityBaseline(run,jobs,context)).toBe(sha);
    // The original all-platform resume guard is deliberately unchanged.
    expect(() => validateNativeBaseline(run,jobs,context)).toThrow();
  });
  it('requires successful Windows core/DB/UI/build steps and sync, not just a green job label', () => {
    for (const change of [{ ancestor: false },{ head: sha },{ workflowId: 999 }]) expect(() => validatePriorityBaseline(run,jobs,{ ...context,...change })).toThrow();
    for (const event of ['pull_request','schedule']) expect(() => validatePriorityBaseline({ ...run,event },jobs,context)).toThrow();
    for (const conclusion of ['skipped','cancelled','failure',null]) {
      expect(() => validatePriorityBaseline(run,jobs.map(job => job.name === 'checks (windows-latest)' ? { ...job,conclusion } : job),context)).toThrow('not successful');
      expect(() => validatePriorityBaseline(run,jobs.map(job => job.steps ? { ...job,steps: job.steps.map(step => step.name === 'Run npm run test:db' ? { ...step,conclusion } : step) } : job),context)).toThrow('not successful');
    }
    expect(() => validatePriorityBaseline(run,jobs.map(job => job.name === 'checks (windows-latest)' ? { ...job,steps: [] } : job),context)).toThrow('step');
  });
  it.each(['src/core/repository.ts','src/ui/App.tsx','src/ui/style.css','src/platform/android-database.ts','src-tauri/src/replacement_store.rs','android/app/build.gradle','package-lock.json','tests/fixtures/nutrition.ts','tests/support/android-main.tsx','tests/native/storage-crash.test.ts','vite.config.ts'])('rejects every changed production/native input: %s', path => {
    expect(() => validatePriorityBaseline(run,jobs,{ ...context,files: [...context.files,path] })).toThrow('changed input');
  });
  it('accepts only the exact added smoke script while preserving versions, dependencies and existing scripts', () => {
    const before = { version: '0.20.0',scripts: { build: 'vite build' },dependencies: { react: '19.3.1' } };
    const after = { ...before,scripts: { ...before.scripts,'test:e2e:smoke': 'playwright test tests/e2e/foundation.spec.ts' } };
    const proof = after => ({ ...context,files: ['package.json'],contents: { 'package.json': { before: JSON.stringify(before),after: JSON.stringify(after) } } });
    expect(validatePriorityBaseline(run,jobs,proof(after))).toBe(sha);
    for (const change of [{ ...after,version: '0.21.0' },{ ...after,dependencies: { react: 'other' } },{ ...after,scripts: { ...after.scripts,build: 'true' } }]) expect(() => validatePriorityBaseline(run,jobs,proof(change))).toThrow();
    expect(() => validatePriorityBaseline(run,jobs,{ ...context,files: ['package.json'] })).toThrow('changed input');
  });
  it('permits only mechanical fixture imports and reviewed startup budgets; assertions remain identical', () => {
    const path = 'tests/e2e/foundation.spec.ts',before = "import { test } from '@playwright/test';\nawait expect(page.locator('[data-catalog=libraries]')).toBeVisible();";
    const after = before.replace("from '@playwright/test'","from '../support/e2e-test'").replace('.toBeVisible();','.toBeVisible({ timeout: 30000 });');
    expect(normalizePriorityUiTest(path,before)).toBe(normalizePriorityUiTest(path,after));
    const proof = text => ({ ...context,files: [path],contents: { [path]: { before,after: text } } });
    expect(validatePriorityBaseline(run,jobs,proof(after))).toBe(sha);
    expect(() => validatePriorityBaseline(run,jobs,proof(after.replace('toBeVisible','toBeHidden')))).toThrow('changed input');
    expect(() => validatePriorityBaseline(run,jobs,{ ...context,files: [path] })).toThrow('changed input');
  });
});


describe('Android-only continuation after native data/signing fix', () => {
  const repository = 'owner/repo',sha = 'a'.repeat(40),head = 'b'.repeat(40);
  const run = { status: 'completed',event: 'workflow_dispatch',head_branch: 'main',repository: { full_name: repository },head_repository: { full_name: repository },workflow_id: 123,path: '.github/workflows/ci.yml',head_sha: sha };
  const passed = name => ({ name,status: 'completed',conclusion: 'success' });
  const jobs = [passed('scope'),{ ...passed('native-checks (windows-latest)'),steps: ['Run npm run test:native','Run npm run test:native-api'].map(passed) },
    { ...passed('desktop (windows-latest, x86_64-pc-windows-msvc, windows-x64, nsis)'),steps: [passed('Run npm run build:desktop -- --target x86_64-pc-windows-msvc --bundles nsis')] },
    { ...passed('desktop (macos-15, aarch64-apple-darwin, macos-arm64, dmg)'),steps: [passed('Run npm run build:desktop -- --target aarch64-apple-darwin --bundles dmg')] }];
  const context = { repository,workflowId: 123,head,ancestor: true,files: ['android/app/build.gradle','android/app/tessera-debug.keystore','scripts/patch-sqlite-lifecycle.mjs'] };
  it('runs only Android APK/emulator and refuses an unverified request', () => {
    expect(ciScope({ name: 'workflow_dispatch',target: 'android_priority',resume: true,ref: 'refs/heads/main' })).toMatchObject({ native: true,bridge: false,desktop: false,checkMatrix: ['windows-latest'] });
    expect(() => ciScope({ name: 'workflow_dispatch',target: 'android_priority' })).toThrow('require verified resume');
    expect(validatePriorityAndroidNative(run,jobs,context)).toBe(sha);
  });
  it('requires all reused native/desktop jobs and actual native/build steps to have passed', () => {
    for (let index = 0; index < jobs.length; index++) {
      expect(() => validatePriorityAndroidNative(run,jobs.filter((_,n) => n !== index),context)).toThrow();
      expect(() => validatePriorityAndroidNative(run,jobs.map((job,n) => n === index ? { ...job,conclusion: 'failure' } : job),context)).toThrow();
      if (jobs[index].steps) expect(() => validatePriorityAndroidNative(run,jobs.map((job,n) => n === index ? { ...job,steps: [] } : job),context)).toThrow('step');
    }
  });
  it('allows exactly the verified install hook and lock metadata, never new dependencies or desktop/Core inputs', () => {
    const before = { version: '0.20.0',scripts: { 'test:e2e:smoke': 'playwright test tests/e2e/foundation.spec.ts' },dependencies: { native: '8.1.1' } };
    const after = { ...before,scripts: { ...before.scripts,postinstall: 'node scripts/patch-sqlite-lifecycle.mjs' } };
    const lockBefore = { packages: { '': { version: '0.20.0',dependencies: { native: '8.1.1' } } },lockfileVersion: 3 };
    const lockAfter = JSON.parse(JSON.stringify(lockBefore));lockAfter.packages[''].hasInstallScript = true;
    const proof = { ...context,files: [...context.files,'package.json','package-lock.json'],contents: { 'package.json': { before: JSON.stringify(before),after: JSON.stringify(after) },'package-lock.json': { before: JSON.stringify(lockBefore),after: JSON.stringify(lockAfter) } } };
    expect(validatePriorityAndroidNative(run,jobs,proof)).toBe(sha);
    expect(() => validatePriorityAndroidNative(run,jobs,{ ...proof,files: [...proof.files,'src/core/repository.ts'] })).toThrow('changed input');
    const bad = JSON.parse(JSON.stringify(lockAfter));bad.packages[''].dependencies.native = 'other';
    expect(() => validatePriorityAndroidNative(run,jobs,{ ...proof,contents: { ...proof.contents,'package-lock.json': { before: JSON.stringify(lockBefore),after: JSON.stringify(bad) } } })).toThrow('changed input');
    expect(() => validatePriorityAndroidNative(run,jobs,{ ...proof,contents: { ...proof.contents,'package.json': { before: JSON.stringify(before),after: JSON.stringify({ ...after,scripts: { ...after.scripts,postinstall: 'different' } }) } } })).toThrow('patch command');
  });
});
