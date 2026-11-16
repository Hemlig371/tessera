import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const cargo = (await readFile('src-tauri/Cargo.lock', 'utf8')).replaceAll('\r\n', '\n');
const npmLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const tauri = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const cargoManifest = await readFile('src-tauri/Cargo.toml', 'utf8');
const android = await readFile('android/app/build.gradle', 'utf8');
const versions = {
  'npm lock': npmLock.version,
  'npm root': npmLock.packages[''].version,
  Tauri: tauri.version,
  Cargo: cargoManifest.match(/^version = "([^"]+)"/m)?.[1],
  'Cargo lock': cargo.match(/name = "tessera"\nversion = "([^"]+)"/)?.[1],
  Android: android.match(/versionName "([^"]+)"/)?.[1],
};
for (const [source, version] of Object.entries(versions)) {
  if (version !== manifest.version) throw new Error(`${source}: ${version}, expected ${manifest.version}`);
}
const versionCode = Number(android.match(/versionCode (\d+)/)?.[1]);
if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('Invalid Android versionCode');
console.log(`App versions agree: ${manifest.version}, Android code ${versionCode}`);
for (const [js, rust] of [['@tauri-apps/api', 'tauri'], ['@tauri-apps/plugin-dialog', 'tauri-plugin-dialog']]) {
  const installed = JSON.parse(await readFile(`node_modules/${js}/package.json`, 'utf8')).version;
  const locked = cargo.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${rust}"\\nversion = "([^"]+)"`))?.[1];
  if (!locked || installed.split('.').slice(0, 2).join('.') !== locked.split('.').slice(0, 2).join('.')) {
    throw new Error(`Tauri major/minor mismatch: ${js} ${installed}, ${rust} ${locked}`);
  }
  if (manifest.dependencies[js] !== installed) throw new Error(`Install the pinned ${js} version`);
  console.log(`Compatible: ${js} ${installed} / ${rust} ${locked}`);
}
