// Real Tauri WebView via tauri-driver (Linux CI). No mock IPC or database.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'tessera-desktop-'));
const driver = spawn('tauri-driver', ['--port', '4444'], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, XDG_DATA_HOME: directory } });
let session;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function request(method, path, body) {
  const response = await fetch('http://127.0.0.1:4444' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const json = await response.json();
  if (!response.ok || json.value?.error) throw new Error(JSON.stringify(json));
  return json.value;
}
const execute = script => request('POST', `/session/${session}/execute/sync`, { script, args: [] });
async function until(script) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { if (await execute('return ' + script)) return; await delay(150); }
  throw new Error('UI timeout: ' + script + '\n' + await execute('return document.body.innerText'));
}
async function clickText(text) {
  const encoded = JSON.stringify(text);
  await until(`[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()===${encoded} || b.getAttribute('aria-label')===${encoded}) && !b.disabled)`);
  await execute(`[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${encoded} || b.getAttribute('aria-label')===${encoded}) && !b.disabled).click();`);
}
async function input(text) {
  await until("!!document.querySelector('[role=dialog] input, [role=dialog] textarea')");
  const element = await request('POST', `/session/${session}/element`, { using: 'css selector', value: '[role=dialog] input, [role=dialog] textarea' });
  await request('POST', `/session/${session}/element/${element['element-6066-11e4-a52e-4f735466cecf']}/value`, { text });
}
async function start() {
  const result = await request('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: resolve('src-tauri/target/debug/tessera') } } } });
  session = result.sessionId;
  await until("!!document.querySelector('aside')");
}
try {
  driver.on('error', e => { throw e; });
  for (let n = 0; ; n++) {
    try { await fetch('http://127.0.0.1:4444/status'); break; }
    catch (e) { if (n > 100) throw e; await delay(200); }
  }
  await start();
  await clickText('+ Новая библиотека'); await input('Native library'); await clickText('Создать');
  await clickText('+ Новая коллекция'); await input('Native collection'); await clickText('Создать');
  await clickText('+ Новая запись'); await input('Native persistent entry'); await clickText('Сохранить');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native persistent entry'))");
  assert.equal(await execute("return document.querySelector('[role=status]').textContent"), 'Запись сохранена');
  const csvPath = join(directory, 'native-export.csv');
  const bridgeResult = await request('POST', `/session/${session}/execute/async`, {
    script: `const done=arguments[arguments.length-1]; (async()=>{
      const invoke=window.__TAURI_INTERNALS__.invoke;
      await invoke('csv_open',{path:${JSON.stringify(csvPath)}});
      await invoke('csv_write',{text:'Название;Число\\r\\nЁж 🦔;0\\r\\n'});
      await invoke('csv_finish');
    })().then(()=>done('ok'),e=>done(String(e)));`, args: [],
  });
  assert.equal(bridgeResult, 'ok');
  assert.equal(await readFile(csvPath, 'utf8'), 'Название;Число\r\nЁж 🦔;0\r\n');
  await request('DELETE', `/session/${session}`); session = undefined;
  await start();
  await execute("[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Native library')).click()");
  await clickText('Native collection');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native persistent entry'))");
  await clickText('+ Во входящие'); await input('Native Inbox transfer'); await clickText('Сохранить');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native Inbox transfer'))");
  await execute("[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Native Inbox transfer')).click()");
  await clickText('Перенести в коллекцию');
  async function selectOption(label, text) {
    const selector = `[...document.querySelectorAll('[role=dialog] label')].find(l=>l.textContent.includes(${JSON.stringify(label)}))?.querySelector('select')`;
    await until(`!!(${selector}) && [...(${selector}).options].some(o=>o.text===${JSON.stringify(text)})`);
    await execute(`const s=${selector}; s.value=[...s.options].find(o=>o.text===${JSON.stringify(text)}).value; s.dispatchEvent(new Event('change',{bubbles:true}));`);
  }
  await selectOption('Библиотека назначения', 'Native library');
  await selectOption('Коллекция назначения', 'Native collection');
  await until("document.querySelector('[role=dialog] input')?.value==='Native Inbox transfer'");
  await clickText('Сохранить');
  await until("!document.querySelector('[role=dialog]') && document.querySelector('[role=status]')?.textContent==='Запись сохранена'");
  await request('DELETE', `/session/${session}`); session = undefined;
  await start();
  await execute("[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Native library')).click()");
  await clickText('Native collection');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native Inbox transfer'))");
  await clickText('+ Быстрая запись'); await input('Native quick entry'); await clickText('Сохранить');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native quick entry'))");
  console.log('PASS: Tauri WebView → shared TS → Rust/rusqlite → disk; persisted after process restart');
} catch (error) {
  // Surface the assertion through the GitHub Checks API as well as runner logs.
  console.error('::error::' + String(error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  throw error;
} finally {
  if (session) await request('DELETE', `/session/${session}`).catch(() => {});
  driver.kill(); await delay(500); await rm(directory, { recursive: true, force: true });
}
