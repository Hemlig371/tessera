import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const cargo = (await readFile('src-tauri/Cargo.lock', 'utf8')).replaceAll('\r\n', '\n');
for (const [js, rust] of [['@tauri-apps/api', 'tauri'], ['@tauri-apps/plugin-dialog', 'tauri-plugin-dialog']]) {
  const installed = JSON.parse(await readFile(`node_modules/${js}/package.json`, 'utf8')).version;
  const locked = cargo.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${rust}"\\nversion = "([^"]+)"`))?.[1];
  if (!locked || installed.split('.').slice(0, 2).join('.') !== locked.split('.').slice(0, 2).join('.')) {
    throw new Error(`Tauri major/minor mismatch: ${js} ${installed}, ${rust} ${locked}`);
  }
  if (manifest.dependencies[js] !== installed) throw new Error(`Install the pinned ${js} version`);
  console.log(`Compatible: ${js} ${installed} / ${rust} ${locked}`);
}
