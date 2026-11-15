import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const build = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', 'src-tauri/sqlite-bridge/Cargo.toml', '--features', 'test-driver', '--bin', 'sqlite-test-driver'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const binary = resolve('src-tauri/sqlite-bridge/target/release/sqlite-test-driver' + (process.platform === 'win32' ? '.exe' : ''));
const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/db'], { stdio: 'inherit', env: { ...process.env, TESSERA_RUST_BRIDGE: binary } });
process.exit(run.status ?? 1);
