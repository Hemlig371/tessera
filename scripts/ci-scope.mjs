import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Native/build contracts trigger the complete matrix; product checkpoints can request it explicitly. */
export function ciScope(event, files = []) {
  const priorityPush = event.name === 'push' && event.ref === 'refs/heads/main' && /\[priority ci\]/i.test(event.message ?? '');
  const target = event.name === 'workflow_dispatch' ? event.target ?? 'all' : priorityPush ? 'priority' : 'all';
  if (!['all', 'priority', 'android', 'android_priority', 'linux_android'].includes(target)) throw new Error('Unsupported native target');
  if (['linux_android','android_priority'].includes(target) && !event.resume) throw new Error('Targeted jobs require verified resume');
  if (event.resume && (event.name !== 'workflow_dispatch' || event.ref !== 'refs/heads/main' || event.fullNative === false)) {
    throw new Error('Native resume requires manual main/full native');
  }
  let result;
  if (event.name === 'workflow_dispatch') result = { native: event.fullNative !== false, reason: 'manual' };
  else {
    if (!['push', 'pull_request'].includes(event.name)) throw new Error('Unsupported CI event');
    if (event.tag) result = { native: true, reason: 'tag' };
    else if (priorityPush || /\[(?:full|native) ci\]/i.test(event.message ?? '')) result = { native: true, reason: 'checkpoint' };
    else {
      const critical = /^(?:\.github\/workflows\/|android\/|src-tauri\/|src\/platform\/|src\/core\/(?:schema|migrate|ports|sqlite-check)\.ts$|scripts\/|tests\/native\/|tests\/support\/(?:android-main|sqlite-contract|rust-database|.*-scenario|draft-fixture|scale)\.tsx?$|tests\/fixtures\/|package(?:-lock)?\.json$|capacitor\.config\.ts$|vite(?:\.[\w-]+)?\.config\.ts$|vitest\.config\.ts$|tsconfig[^/]*\.json$)/;
      result = { native: files.some(path => !/\.md$/i.test(path) && critical.test(path)), reason: 'changed-paths' };
    }
  }
  const desktopMatrix = [
    { os: 'windows-latest', target: 'x86_64-pc-windows-msvc', artifact: 'windows-x64', bundles: 'nsis' },
    { os: 'macos-15', target: 'aarch64-apple-darwin', artifact: 'macos-arm64', bundles: 'dmg' },
    { os: 'ubuntu-24.04', target: 'x86_64-unknown-linux-gnu', artifact: 'linux-x64', bundles: 'appimage' },
  ].filter(job => (target !== 'linux_android' || job.os === 'ubuntu-24.04') && (target !== 'priority' || job.os !== 'ubuntu-24.04'));
  return { ...result, target, checkMatrix: ['priority','android_priority'].includes(target) ? ['windows-latest'] : ['ubuntu-24.04', 'windows-latest'], bridgeMatrix: ['priority','android_priority'].includes(target) ? ['windows-latest'] : ['ubuntu-24.04', 'windows-latest'], bridge: result.native && ['all','priority'].includes(target), desktop: result.native && !['android','android_priority'].includes(target), desktopMatrix };
}

// Resume only the unfinished native acceptance. This is not a successful full CI
// on the new SHA: the summary records which checks belong to the ancestor.
export function validateNativeBaseline(run, jobs, { repository, workflowId, head, ancestor, files, target = 'all' }) {
  if (run.status !== 'completed' || run.event !== 'push' || run.head_branch !== 'main' ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.workflow_id !== workflowId || run.path !== '.github/workflows/ci.yml' ||
      !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || run.head_sha === head || !ancestor) {
    throw new Error('Baseline must be a completed main push of this workflow and a strict ancestor');
  }
  for (const name of ['scope', 'checks (ubuntu-24.04)', 'checks (windows-latest)', 'sync-foundation']) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
      throw new Error(`Baseline check is not successful: ${name}`);
    }
  }
  // Fail closed: UI/Core, dependencies, fixtures, platforms, and test harnesses
  // must match the baseline. Native/storage and the reviewed resume gate alone
  // may differ; all native jobs run again, including both bridge platforms.
  const allowed = new Set(['src-tauri/src/replacement_store.rs', '.github/workflows/ci.yml',
    'scripts/ci-scope.mjs', 'tests/unit/ci-scope.test.mjs', 'AGENTS.md', 'implementation.md', 'README.md', 'tests/fixtures/README.md']);
  if (target === 'android' || target === 'linux_android') for (const path of androidImportPaths) allowed.add(path);
  if (target === 'linux_android') allowed.add('scripts/desktop-e2e.mjs');
  const changed = files.filter(path => !allowed.has(path));
  if (changed.length) throw new Error(`Baseline does not cover changed paths: ${changed.join(', ')}`);
  return run.head_sha;
}

// User-directed platform priority: no Linux application checks are claimed or reused.
// All production/native inputs must be identical; only reviewed test/CI plumbing may differ.
export function normalizePriorityUiTest(path, source) {
  let result = source.replaceAll("from '../support/e2e-test'", "from '@playwright/test'");
  if (['tests/e2e/attachments.spec.ts','tests/e2e/foundation.spec.ts','tests/e2e/named-profiles.spec.ts'].includes(path)) {
    result = result.replace('  test.setTimeout(60000);\n', '');
    result = result.replace("await expect(page.locator('[data-catalog=libraries]')).toBeVisible({ timeout: 30000 });", "await expect(page.locator('[data-catalog=libraries]')).toBeVisible();");
    result = result.replace("await expect(page.getByRole('button', { name: '+ Во входящие', exact: true })).toBeVisible({ timeout: 30000 });", "await expect(page.getByRole('button', { name: '+ Во входящие', exact: true })).toBeVisible();");
  }
  if (path === 'tests/e2e/ui-catalog.spec.ts') result = result.replace('  test.setTimeout(90000);\n','').replace('expect(result.ok(), await result.text()).toBe(true);','expect(result.ok()).toBe(true);');
  return result;
}
export function validatePriorityBaseline(run, jobs, { repository, workflowId, head, ancestor, files, contents = {}, androidContinuation = false }) {
  if (run.status !== 'completed' || !['push','workflow_dispatch'].includes(run.event) || run.head_branch !== 'main' ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.workflow_id !== workflowId || run.path !== '.github/workflows/ci.yml' ||
      !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || run.head_sha === head || !ancestor) throw new Error('Priority baseline must be a completed strict main ancestor of this workflow');
  const selected = new Map();
  for (const name of ['scope','checks (windows-latest)','sync-foundation']) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') throw new Error(`Priority baseline check is not successful: ${name}`);
    selected.set(name,matches[0]);
  }
  function step(job, names) {
    const matches = (job.steps ?? []).filter(step => names.includes(step.name));
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') throw new Error(`Priority baseline step is not successful: ${names.join(' / ')}`);
  }
  const checks = selected.get('checks (windows-latest)');
  for (const command of ['typecheck','check:platforms','lint','licenses','test:unit','test:db','build']) step(checks,[`Run npm run ${command}`]);
  step(checks,['Run npm run test:e2e','Run npm run test:e2e:smoke']);
  step(checks,['Windows smoke cleanup regression']);
  step(selected.get('sync-foundation'),['Run npm run test:sync']);
  validatePriorityInputs(files,contents,androidContinuation);
  return run.head_sha;
}

function validatePriorityInputs(files, contents, androidContinuation = false) {
  const allowed = new Set(['.github/workflows/ci.yml','scripts/ci-scope.mjs','tests/unit/ci-scope.test.mjs','AGENTS.md','implementation.md',
    'tests/support/e2e-plugin.ts','tests/support/open-e2e.ts','tests/support/http-sqlite-session.ts','tests/support/e2e-test.ts','tests/db/http-sqlite-session.test.ts','README.md']);
  if (androidContinuation) for (const path of [
    'android/app/build.gradle','android/app/tessera-debug.keystore',
    'android/app/src/androidTest/java/app/tessera/personal/SqliteLifecycleTest.java',
    'scripts/patch-sqlite-lifecycle.mjs','scripts/run-android-tests.mjs','scripts/check-android-manifest.py',
  ]) allowed.add(path);
  for (const path of files) {
    if (allowed.has(path)) continue;
    const proof = contents[path];
    if (/^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/.test(path) && proof && normalizePriorityUiTest(path,proof.before) === normalizePriorityUiTest(path,proof.after)) continue;
    if (path === 'package.json' && proof) {
      const before = JSON.parse(proof.before), after = JSON.parse(proof.after);
      if (after.scripts?.['test:e2e:smoke'] !== 'playwright test tests/e2e/foundation.spec.ts') throw new Error('Unexpected UI smoke command');
      delete before.scripts['test:e2e:smoke']; delete after.scripts['test:e2e:smoke'];
      if (androidContinuation) {
        if (after.scripts?.postinstall !== 'node scripts/patch-sqlite-lifecycle.mjs') throw new Error('Unexpected native patch command');
        delete before.scripts.postinstall; delete after.scripts.postinstall;
      }
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
    }
    if (androidContinuation && path === 'package-lock.json' && proof) {
      const before = JSON.parse(proof.before),after = JSON.parse(proof.after);
      if (after.packages?.['']?.hasInstallScript !== true) throw new Error('Missing native patch install marker');
      delete before.packages[''].hasInstallScript; delete after.packages[''].hasInstallScript;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
    }
    throw new Error(`Priority baseline does not cover changed input: ${path}`);
  }
}

export function validatePriorityAndroidNative(run, jobs, { repository, workflowId, head, ancestor, files, contents = {} }) {
  if (run.status !== 'completed' || !['push','workflow_dispatch'].includes(run.event) || run.head_branch !== 'main' ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.workflow_id !== workflowId || run.path !== '.github/workflows/ci.yml' ||
      !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || run.head_sha === head || !ancestor) throw new Error('Android priority continuation requires a completed native main ancestor');
  for (const name of ['scope','native-checks (windows-latest)',
    'desktop (windows-latest, x86_64-pc-windows-msvc, windows-x64, nsis)',
    'desktop (macos-15, aarch64-apple-darwin, macos-arm64, dmg)']) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') throw new Error(`Priority native baseline check is not successful: ${name}`);
    const commands = name === 'native-checks (windows-latest)' ? ['Run npm run test:native','Run npm run test:native-api'] : name.startsWith('desktop (windows') ? ['Run npm run build:desktop -- --target x86_64-pc-windows-msvc --bundles nsis'] : name.startsWith('desktop (macos') ? ['Run npm run build:desktop -- --target aarch64-apple-darwin --bundles dmg'] : [];
    for (const command of commands) {
      const steps = (matches[0].steps ?? []).filter(step => step.name === command);
      if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') throw new Error(`Priority native baseline step is not successful: ${command}`);
    }
  }
  validatePriorityInputs(files,contents,true);
  return run.head_sha;
}

const androidImportPaths = ['android/app/src/main/java/app/tessera/personal/ImportFilesPlugin.kt',
  'android/app/src/main/java/app/tessera/personal/ReplacementStore.kt'];
export function validateAndroidContinuation(run, jobs, { repository, workflowId, head, ancestor, files, target = 'android' }) {
  if (run.status !== 'completed' || !['push', 'workflow_dispatch'].includes(run.event) || run.head_branch !== 'main' ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.workflow_id !== workflowId || run.path !== '.github/workflows/ci.yml' ||
      !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') || run.head_sha === head || !ancestor) {
    throw new Error('Android continuation requires a completed native ancestor from this main workflow');
  }
  for (const name of ['scope', 'native-checks (ubuntu-24.04)', 'native-checks (windows-latest)',
    'desktop (windows-latest, x86_64-pc-windows-msvc, windows-x64, nsis)',
    'desktop (macos-15, aarch64-apple-darwin, macos-arm64, dmg)',
    ...(target === 'linux_android' ? [] : ['desktop (ubuntu-24.04, x86_64-unknown-linux-gnu, linux-x64, appimage)'])]) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') throw new Error(`Native baseline check is not successful: ${name}`);
  }
  const allowed = new Set([...androidImportPaths, '.github/workflows/ci.yml', 'scripts/ci-scope.mjs',
    'tests/unit/ci-scope.test.mjs', 'implementation.md', 'README.md']);
  if (target === 'linux_android') allowed.add('scripts/desktop-e2e.mjs');
  if (files.some(path => !allowed.has(path))) throw new Error('Desktop/native inputs changed after the native baseline');
  return run.head_sha;
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Cannot verify baseline: GitHub ${response.status}`);
  return response.json();
}

async function baselineRun(id) {
  if (!/^[1-9][0-9]*$/.test(id ?? '')) throw new Error('A numeric baseline_run is required');
  const run = await github(`actions/runs/${id}`);
  const jobs = [];
  for (let page = 1; ; page++) {
    const result = await github(`actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
  }
  const head = process.env.GITHUB_SHA;
  let ancestor = false, files = [];
  if (/^[a-f0-9]{40}$/.test(run.head_sha ?? '') && /^[a-f0-9]{40}$/.test(head ?? '')) {
    try { execFileSync('git', ['merge-base', '--is-ancestor', run.head_sha, head]); ancestor = true; } catch { /* rejected below */ }
    files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', run.head_sha, head], { encoding: 'utf8' }).split('\0').filter(Boolean);
  }
  const contents = {};
  for (const path of files) if (['package.json','package-lock.json'].includes(path) || /^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/.test(path)) {
    try { contents[path] = { before: execFileSync('git',['show',`${run.head_sha}:${path}`],{ encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }), after: execFileSync('git',['show',`${head}:${path}`],{ encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }) }; } catch { /* Missing comparison proof fails closed. */ }
  }
  return { run, jobs, context: { repository: process.env.GITHUB_REPOSITORY, head, ancestor, files, contents } };
}
async function nativeBaseline(id, nativeId, target) {
  const baseline = await baselineRun(id), current = await github(`actions/runs/${process.env.GITHUB_RUN_ID}`);
  if (target === 'android_priority') {
    const sha = validatePriorityBaseline(baseline.run,baseline.jobs,{ ...baseline.context,workflowId: current.workflow_id,androidContinuation: true });
    const native = await baselineRun(nativeId);
    const nativeSha = validatePriorityAndroidNative(native.run,native.jobs,{ ...native.context,workflowId: current.workflow_id });
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Partial Android continuation\nWindows fast/sync baseline [${id}](${baseline.run.html_url}), SHA \`${sha}\`. Windows native and Windows/macOS desktop baseline [${nativeId}](${native.run.html_url}), SHA \`${nativeSha}\`. Only reviewed Android lifecycle/signing/data-test changes are allowed; Core/UI/desktop inputs and dependencies must remain identical.\nOnly APK and emulator data/force-stop checks run on \`${process.env.GITHUB_SHA}\`. Linux application checks/builds are intentionally omitted. This is not one full green run on the new SHA.\n`);
    return;
  }
  const sha = (target === 'priority' ? validatePriorityBaseline : validateNativeBaseline)(baseline.run, baseline.jobs, { ...baseline.context, workflowId: current.workflow_id, target });
  let description = `Native contracts, desktop builds/WebView, APK and emulator run on \`${process.env.GITHUB_SHA}\`.`;
  if (target === 'priority') description = `Windows native contracts, Windows/macOS desktop builds, APK and emulator run on \`${process.env.GITHUB_SHA}\`.`;
  if (target === 'android' || target === 'linux_android') {
    const native = await baselineRun(nativeId);
    const nativeSha = validateAndroidContinuation(native.run, native.jobs, { ...native.context, workflowId: current.workflow_id, target });
    description = `Desktop/native evidence: [${nativeId}](${native.run.html_url}), SHA \`${nativeSha}\`. Only ${target === 'linux_android' ? 'Linux desktop/WebView, ' : ''}APK and emulator run on \`${process.env.GITHUB_SHA}\`.`;
  }
  const evidence = target === 'priority' ? 'successful Windows fast checks (core/DB/UI/build) and sync-foundation; production/native inputs unchanged. Linux application checks/builds intentionally omitted by user directive; changed E2E harness is not claimed CI-green' : 'successful Linux/Windows fast checks and sync-foundation';
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Partial native continuation\nBaseline [${id}](${baseline.run.html_url}), SHA \`${sha}\`: ${evidence}.\n${description} This is not one full green run on the new SHA.\n`);
}
async function main() {
  const payload = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const name = process.env.GITHUB_EVENT_NAME;
  let files = [];
  if (name !== 'workflow_dispatch') {
    const head = process.env.GITHUB_SHA, base = name === 'pull_request' ? payload.pull_request?.base?.sha : payload.before;
    if (!/^[a-f0-9]{40}$/i.test(head ?? '') || !/^[a-f0-9]{40}$/i.test(base ?? '')) throw new Error('Invalid CI comparison');
    const args = /^0+$/.test(base) ? ['ls-tree', '-r', '--name-only', '-z', head] : ['diff', '--name-only', '-z', base, head];
    files = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
  }
  const resume = String(payload.inputs?.native_resume ?? 'false') === 'true';
  const result = ciScope({ name, ref: process.env.GITHUB_REF, resume, target: payload.inputs?.native_target, tag: process.env.GITHUB_REF?.startsWith('refs/tags/'), fullNative: String(payload.inputs?.full_native ?? 'true') === 'true', message: payload.head_commit?.message }, files);
  if (resume) await nativeBaseline(payload.inputs?.baseline_run, payload.inputs?.native_baseline_run, result.target);
  await appendFile(process.env.GITHUB_OUTPUT, `native=${result.native}\nbridge=${result.bridge}\ndesktop=${result.desktop}\nresume=${resume}\ndesktop_matrix=${JSON.stringify(result.desktopMatrix)}\ncheck_matrix=${JSON.stringify(result.checkMatrix)}\nbridge_matrix=${JSON.stringify(result.bridgeMatrix)}\n`);
  console.log(`Native matrix: ${result.native}; target: ${result.target}; selection: ${result.reason}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
