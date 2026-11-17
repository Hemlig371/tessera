import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Native/build contracts trigger the complete matrix; product checkpoints can request it explicitly. */
export function ciScope(event, files = []) {
  const target = event.name === 'workflow_dispatch' ? event.target ?? 'all' : 'all';
  if (!['all', 'android'].includes(target)) throw new Error('Unsupported native target');
  if (event.resume && (event.name !== 'workflow_dispatch' || event.ref !== 'refs/heads/main' || event.fullNative === false || target !== 'all')) {
    throw new Error('Native resume requires manual main/full native/all targets');
  }
  let result;
  if (event.name === 'workflow_dispatch') result = { native: event.fullNative !== false, reason: 'manual' };
  else {
    if (!['push', 'pull_request'].includes(event.name)) throw new Error('Unsupported CI event');
    if (event.tag) result = { native: true, reason: 'tag' };
    else if (/\[(?:full|native) ci\]/i.test(event.message ?? '')) result = { native: true, reason: 'checkpoint' };
    else {
      const critical = /^(?:\.github\/workflows\/|android\/|src-tauri\/|src\/platform\/|src\/core\/(?:schema|migrate|ports|sqlite-check)\.ts$|scripts\/|tests\/native\/|tests\/support\/(?:android-main|sqlite-contract|rust-database|.*-scenario|draft-fixture|scale)\.tsx?$|tests\/fixtures\/|package(?:-lock)?\.json$|capacitor\.config\.ts$|vite(?:\.[\w-]+)?\.config\.ts$|vitest\.config\.ts$|tsconfig[^/]*\.json$)/;
      result = { native: files.some(path => !/\.md$/i.test(path) && critical.test(path)), reason: 'changed-paths' };
    }
  }
  return { ...result, target, bridge: result.native && target === 'all', desktop: result.native && target === 'all' };
}

// Resume only the unfinished native acceptance. This is not a successful full CI
// on the new SHA: the summary records which checks belong to the ancestor.
export function validateNativeBaseline(run, jobs, { repository, workflowId, head, ancestor, files }) {
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
    'scripts/ci-scope.mjs', 'tests/unit/ci-scope.test.mjs', 'AGENTS.md', 'audit.md', 'README.md']);
  const changed = files.filter(path => !allowed.has(path));
  if (changed.length) throw new Error(`Baseline does not cover changed paths: ${changed.join(', ')}`);
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

async function nativeBaseline(id) {
  if (!/^[1-9][0-9]*$/.test(id ?? '')) throw new Error('A numeric baseline_run is required');
  const run = await github(`actions/runs/${id}`);
  const current = await github(`actions/runs/${process.env.GITHUB_RUN_ID}`);
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
  const sha = validateNativeBaseline(run, jobs, { repository: process.env.GITHUB_REPOSITORY, workflowId: current.workflow_id, head, ancestor, files });
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Partial native continuation\nBaseline [${id}](${run.html_url}), SHA \`${sha}\`: successful Linux/Windows fast checks and sync-foundation.\nNative contracts, desktop builds/WebView, APK and emulator run on \`${head}\`. This is not one full green run on the new SHA.\n`);
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
  if (resume) await nativeBaseline(payload.inputs?.baseline_run);
  await appendFile(process.env.GITHUB_OUTPUT, `native=${result.native}\nbridge=${result.bridge}\ndesktop=${result.desktop}\nresume=${resume}\n`);
  console.log(`Native matrix: ${result.native}; target: ${result.target}; selection: ${result.reason}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
