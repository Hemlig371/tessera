// Real Tauri WebView via tauri-driver (Linux CI). No mock IPC or database.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
  if (text === 'Закрыть' && await execute("return !!document.querySelector('[data-editor]')")) { await clickText('Назад'); return; }
  if (['+ Новая запись','Варианты создания','CSV','Настройки библиотеки','Стартовый экран библиотеки','Настройки коллекции','Поля','Форма','Карточка','Список','Быстрая форма','Пресеты создания','Представления'].includes(text) && await execute("return [...document.querySelectorAll('button')].some(button=>button.getAttribute('aria-label')==='К списку')")) await clickText('К списку');
  if (text === '+ Быстрая запись') { await clickText('Варианты создания'); await clickText('Быстрая запись'); return; }
  if (['Настройки библиотеки','Стартовый экран библиотеки','Настройки коллекции','Поля','Форма','Карточка','Список','Быстрая форма','Пресеты создания','Представления'].includes(text)) {
    await until("!!document.querySelector('#constructor-toggle:not(:disabled)')");
    if (!await execute("return document.querySelector('#constructor-toggle').getAttribute('aria-pressed')==='true'")) await clickText('Конструктор');
  }
  const encoded = JSON.stringify(text);
  await until(`[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()===${encoded} || b.getAttribute('aria-label')===${encoded}) && !b.matches(':disabled') && !b.closest('[inert]'))`);
  await execute(`[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${encoded} || b.getAttribute('aria-label')===${encoded}) && !b.matches(':disabled') && !b.closest('[inert]')).click();`);
}
async function openLibrary(name) {
  const selector = `[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes(${JSON.stringify(name)}) && !b.matches(':disabled') && !b.closest('[inert]'))`;
  await until(`!!(${selector})`); await execute(`(${selector}).click()`);
}
async function input(text) {
  const selector = '[data-editor] input:not([type=checkbox]):not([type=file]):not([type=hidden]):not(:disabled), [data-editor] textarea:not(:disabled)';
  await until(`!!document.querySelector(${JSON.stringify(selector)})`);
  const element = await request('POST', `/session/${session}/element`, { using: 'css selector', value: selector });
  await request('POST', `/session/${session}/element/${element['element-6066-11e4-a52e-4f735466cecf']}/value`, { text: text.replaceAll('\n', '\uE007') });
  await until(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`);
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
  await clickText('Готово, к данным');
  await until("document.querySelector('#constructor-toggle')?.getAttribute('aria-pressed')==='false' && ![...document.querySelectorAll('button')].some(button=>button.textContent==='Поля')");
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
  await openLibrary('Native library');
  await clickText('Native collection');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native persistent entry'))");
  await clickText('+ Во входящие'); await input('Native Inbox transfer'); await clickText('Сохранить');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native Inbox transfer'))");
  await execute("[...document.querySelectorAll('.entry')].find(b=>b.textContent.includes('Native Inbox transfer')).click()");
  await clickText('Перенести в коллекцию');
  async function selectOption(label, text) {
    const selector = `[...document.querySelectorAll('[data-editor] label')].find(l=>[...l.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim()===${JSON.stringify(label)})?.querySelector('select')`;
    await until(`!!(${selector}) && !(${selector}).matches(':disabled') && [...(${selector}).options].some(o=>o.text===${JSON.stringify(text)})`);
    await execute(`const s=${selector}; s.value=[...s.options].find(o=>o.text===${JSON.stringify(text)}).value; s.dispatchEvent(new Event('change',{bubbles:true}));`);
  }
  await selectOption('Библиотека назначения', 'Native library');
  await selectOption('Коллекция назначения', 'Native collection');
  await until("document.querySelector('[data-editor] input')?.value==='Native Inbox transfer'");
  await clickText('Сохранить');
  await until("!document.querySelector('[data-editor]') && document.querySelector('[role=status]')?.textContent==='Запись сохранена'");
  await request('DELETE', `/session/${session}`); session = undefined;
  await start();
  await openLibrary('Native library');
  await clickText('Native collection');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native Inbox transfer'))");
  await clickText('+ Быстрая запись'); await input('Native quick entry'); await clickText('Сохранить');
  await until("[...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native quick entry'))");
  await clickText('+ Новая запись'); await input('Native draft survives restart');
  let nativeDraft;
  for (let n=0; n<100 && !nativeDraft; n++) {
    for (const file of await readdir(directory,{recursive:true})) {
      if (file.includes('operational/drafts/') && file.endsWith('.json') && (await readFile(join(directory,file),'utf8')).includes('Native draft survives restart')) nativeDraft=join(directory,file);
    }
    if (!nativeDraft) await delay(200);
  }
  assert.ok(nativeDraft,'Debounced draft was not written through native file IPC');
  await request('DELETE', `/session/${session}`); session=undefined;
  await start();
  assert.equal(await execute("return !!document.querySelector('[data-editor]')"),false);
  await openLibrary('Native library');
  await clickText('Native collection');
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='+ Новая запись' && !b.matches(':disabled') && !b.closest('[inert]'))");
  assert.equal(await execute("return !!document.querySelector('[data-editor]')"),false);
  await clickText('+ Новая запись');
  await until("document.querySelector('[data-editor] input')?.value==='Native draft survives restart'");
  await clickText('Закрыть');
  await until("!document.querySelector('[data-editor]')");
  assert.ok((await readFile(nativeDraft,'utf8')).includes('Native draft survives restart'));
  await clickText('+ Новая запись');
  await until("document.querySelector('[data-editor] input')?.value==='Native draft survives restart'");
  await clickText('Сохранить');
  await until("!document.querySelector('[data-editor]')");
  await assert.rejects(readFile(nativeDraft),{code:'ENOENT'});
  await clickText('Представления');
  await execute("const input=document.querySelector('[data-editor] form:last-of-type input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Native profile'); input.dispatchEvent(new Event('input',{bubbles:true}));");
  await clickText('Создать представление');
  await until("!document.querySelector('[data-editor]') && document.querySelector('.profile-switcher option:checked')?.textContent==='Native profile'");
  await clickText('Представления');
  await execute("const select=document.querySelector('[data-editor] select'); select.value=[...select.options].find(option=>option.text==='Native profile').value; select.dispatchEvent(new Event('change',{bubbles:true}));");
  await until("!!document.querySelector('[data-editor] input[type=checkbox]:not(:disabled)')");
  await execute("document.querySelector('[data-editor] input[type=checkbox]').click()");
  await clickText('Сохранить представление');
  await until("!!document.querySelector('[data-editor] input[type=checkbox]:disabled:checked')");
  await clickText('Закрыть'); await until("!document.querySelector('[data-editor]')");
  await request('DELETE', `/session/${session}`); session=undefined; await start();
  await openLibrary('Native library'); await clickText('Native collection');
  await until("document.querySelector('.profile-switcher option:checked')?.textContent==='Native profile'");
  await clickText('Пресеты создания'); await input('Native preset');
  await execute("document.querySelector('[data-editor] fieldset input[type=checkbox]').click()");
  await until("!!document.querySelector('[data-editor] input[aria-label=Название]')");
  await execute("const input=document.querySelector('[data-editor] input[aria-label=Название]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Native preset entry'); input.dispatchEvent(new Event('input',{bubbles:true}));");
  await clickText('Сохранить пресет'); await until("!document.querySelector('[data-editor]')");
  await clickText('Варианты создания'); await clickText('Native preset');
  await until("document.querySelector('[data-editor] input')?.value==='Native preset entry'");
  await clickText('Закрыть'); await until("!document.querySelector('[data-editor]')");
  await clickText('+ Новая запись'); await until("document.querySelector('[data-editor] input')?.value==='Native preset entry'");
  await clickText('Сохранить'); await until("!document.querySelector('[data-editor]')");
  await request('DELETE', `/session/${session}`); session=undefined; await start();
  await openLibrary('Native library'); await clickText('Native collection');
  await until("[...document.querySelectorAll('.entry')].some(row=>row.textContent.includes('Native preset entry'))");
  await clickText('Поля'); await clickText('+ Новое поле'); await input('Native Markdown');
  await selectOption('Тип поля', 'Markdown'); await clickText('Сохранить поле');
  await until("[...document.querySelectorAll('.field-list b')].some(element=>element.textContent==='Native Markdown')");
  await clickText('Закрыть'); await until("!document.querySelector('[data-editor]')");
  await clickText('Настройки коллекции');
  await selectOption('Поле для входящих', 'Native Markdown');
  await execute("document.querySelector('[data-editor] fieldset input[type=checkbox]').click()");
  await selectOption('Поле заголовка Markdown', 'Название'); await selectOption('Поле текста Markdown', 'Native Markdown');
  await clickText('Сохранить'); await until("!document.querySelector('[data-editor]')");
  const markdown = '# Native mapped **ёж**\n\n**Native body**';
  await clickText('+ Во входящие'); await input(markdown); await clickText('Сохранить');
  await until("[...document.querySelectorAll('.entry')].some(row=>row.textContent.includes('Native mapped'))");
  await execute("[...document.querySelectorAll('.entry')].find(row=>row.textContent.includes('Native mapped')).click()");
  await clickText('Перенести в коллекцию'); await selectOption('Библиотека назначения', 'Native library'); await selectOption('Коллекция назначения', 'Native collection');
  await until("document.querySelector('[data-editor] input')?.value==='Native mapped ёж'");
  await clickText('Сохранить'); await until("!document.querySelector('[data-editor]') && !!document.querySelector('.detail .markdown strong')");
  assert.equal(await execute("return document.querySelector('.detail .markdown strong').textContent"),'Native body');
  assert.equal(await execute("return document.querySelector('.detail .original-content').textContent"),markdown);
  const guarded = await request('POST', `/session/${session}/execute/async`, {
    script: "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('external_open_url',{url:'javascript:alert(1)'}).then(()=>done('unexpected'),error=>done(String(error)));", args: [],
  });
  assert.equal(guarded,'invalidUrl');
  await openLibrary('Native library'); await clickText('Native collection');
  await clickText('+ Новая коллекция'); await input('Native CSV'); await clickText('Создать');
  await clickText('CSV');
  await execute(`const source=new DataTransfer(); source.items.add(new File(['Название\\n'+Array.from({length:5000},(_,i)=>'CSV '+i).join('\\n')],'cancel.csv',{type:'text/csv'})); const field=document.querySelector('input[type=file]'); field.files=source.files; field.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until("document.querySelector('[data-editor] [role=status]')?.textContent==='Прочитано строк: 5000'");
  await clickText('Проверить и показать предосмотр');
  await until("document.querySelector('[data-editor] [role=status]')?.textContent.startsWith('Проверено строк: 5000')");
  await clickText('Подтвердить импорт');
  await until("/Обработано записей: [1-9]/.test(document.querySelector('[data-editor] [role=status]')?.textContent)");
  await clickText('Отменить операцию CSV');
  await until("document.querySelector('[data-editor] [role=status]')?.textContent==='Операция отменена. Данные базы не изменены.'");
  await clickText('Закрыть');
  await until("!document.querySelector('[data-editor]') && document.body.innerText.includes('Загружено записей: 0')");
  await clickText('CSV');
  await execute(`const source=new DataTransfer(); source.items.add(new File(['Название\\n'+Array.from({length:250},(_,i)=>'Native row '+String(i).padStart(3,'0')).join('\\n')],'context.csv',{type:'text/csv'})); const field=document.querySelector('input[type=file]'); field.files=source.files; field.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until("document.querySelector('[data-editor] [role=status]')?.textContent==='Прочитано строк: 250'");
  await clickText('Проверить и показать предосмотр');
  await until("document.querySelector('[data-editor] [role=status]')?.textContent.startsWith('Проверено строк: 250')");
  await clickText('Подтвердить импорт');
  await until("document.querySelector('[data-editor] [role=status]')?.textContent.startsWith('Импортировано записей: 250')");
  await clickText('Закрыть');
  await until("!document.querySelector('[data-editor]') && document.querySelector('.list-meta')?.textContent==='Загружено записей: 100'");
  for (const count of [200,250]) {
    await clickText('Показать ещё'); await until(`document.querySelector('.list-meta')?.textContent==='Загружено записей: ${count}'`);
  }
  await execute("document.querySelector('.entry-scroll').scrollTop=document.querySelector('.entry').getBoundingClientRect().height*219");
  await until("!!document.querySelector('.entry[data-index=\"219\"]')");
  const deepOffset = await execute("return document.querySelector('.entry-scroll').scrollTop");
  const deepProfile = await execute("return document.querySelector('.profile-switcher select').value");
  await execute("document.querySelector('.entry[data-index=\"219\"]').click()");
  await until("!!document.querySelector('.detail #record-title')");
  const originalDeepTitle = await execute("return document.querySelector('.detail #record-title').textContent");
  await clickText('Редактировать');
  await until("!!document.querySelector('[data-editor] input:not(:disabled)')");
  await execute("const input=document.querySelector('[data-editor] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,input.value+' (saved)');input.dispatchEvent(new Event('input',{bubbles:true}))");
  await clickText('Сохранить'); await until("!document.querySelector('[data-editor]') && !!document.querySelector('.detail')");
  await clickText('История записи'); await until("document.querySelectorAll('.history-versions button').length===2");
  await execute("[...document.querySelectorAll('.history-versions button')].at(-1).click()");
  await clickText('Восстановить эту версию'); await until("!document.querySelector('[data-editor]') && !!document.querySelector('.detail')");
  assert.equal(await execute("return document.querySelector('.detail #record-title').textContent"), originalDeepTitle);
  await clickText('История записи'); await until("document.querySelectorAll('.history-versions button').length===3");
  await clickText('Очистить историю записи'); await clickText('Подтвердить очистку истории');
  await until("document.querySelector('[data-editor] [role=status]')?.textContent==='Сохранённых версий нет.'");
  await clickText('Назад'); await until("!document.querySelector('[data-editor]') && !!document.querySelector('.detail')");
  await clickText('К списку');
  await until("document.querySelector('.list-meta')?.textContent==='Загружено записей: 250'");
  await until(`Math.abs(document.querySelector('.entry-scroll').scrollTop-${deepOffset})<1`);
  assert.equal(await execute("return document.querySelector('.profile-switcher select').value"), deepProfile);
  await clickText('Глобальный поиск');
  await until("document.querySelector('h1')?.textContent==='Все записи'");
  await execute("const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Native row');input.dispatchEvent(new Event('input',{bubbles:true}))");
  await clickText('Назад');
  await until("document.querySelector('.list-meta')?.textContent==='Загружено записей: 250'");
  await until(`Math.abs(document.querySelector('.entry-scroll').scrollTop-${deepOffset})<1`);
  await clickText('Стартовый экран библиотеки');
  await selectOption('Стартовый экран библиотеки', 'Выбранная коллекция');
  await selectOption('Выбранная коллекция', 'Native CSV');
  await selectOption('Каталог коллекций', 'Список');
  await clickText('Сохранить'); await until("!document.querySelector('[data-editor]') && !document.querySelector('#constructor-toggle').disabled");
  await clickText('Все библиотеки'); await until("!!document.querySelector('[data-catalog=libraries]')");
  await clickText('Открыть библиотеку «Native library»');
  await until("document.querySelector('.browse-screen h1')?.textContent==='Native CSV' && !!document.querySelector('.entry')");
  await clickText('К коллекциям'); await until("!!document.querySelector('[data-catalog=collections] .catalog-list')");
  await request('DELETE', `/session/${session}`); session = undefined; await start();
  await until("!!document.querySelector('[data-catalog=libraries]') && !document.querySelector('[data-editor]')");
  await clickText('Открыть библиотеку «Native library»');
  await until("document.querySelector('.browse-screen h1')?.textContent==='Native CSV' && !!document.querySelector('.entry')");
  await clickText('Оформление'); await selectOption('Тема', 'Тёмная');
  await selectOption('Плотность', 'Компактная'); await selectOption('Размер текста', '150%'); await selectOption('Каталог библиотек', 'Список');
  await clickText('Сохранить оформление');
  await until("!document.querySelector('[data-editor]') && document.documentElement.dataset.theme==='dark'");
  await request('DELETE', `/session/${session}`); session = undefined; await start();
  await until("document.documentElement.dataset.theme==='dark' && document.documentElement.dataset.density==='compact' && !!document.querySelector('[data-catalog=libraries] .catalog-list')");
  assert.equal(await execute("return getComputedStyle(document.documentElement).fontSize"),'22.5px');
  await openLibrary('Native library'); await clickText('Native collection'); await clickText('Форма');
  await until("!!document.querySelector('.row-designer select')");
  await execute("const columns=document.querySelector('.row-designer select');columns.value='3';columns.dispatchEvent(new Event('change',{bubbles:true}));");
  await clickText('Сохранить настройку'); await until("!document.querySelector('[data-editor]')");
  await clickText('Варианты создания'); await clickText('Обычная форма');
  await until("!!document.querySelector('[data-editor] .layout-row') && getComputedStyle(document.querySelector('[data-editor] .layout-row')).gridTemplateColumns.split(' ').length===3");
  await request('POST', `/session/${session}/window/rect`, { width: 390, height: 844 });
  await until("getComputedStyle(document.querySelector('[data-editor] .layout-row')).gridTemplateColumns.split(' ').length===1");
  assert.equal(await execute("return document.documentElement.scrollWidth<=innerWidth"),true);
  await input('Native adaptive draft'); await clickText('Закрыть'); await until("!document.querySelector('[data-editor]')");
  assert.ok((await readFile(nativeDraft, 'utf8')).includes('Native adaptive draft'));
  const damagedDraft = '{broken native draft'; await writeFile(nativeDraft, damagedDraft, 'utf8');
  await clickText('+ Новая запись'); await until("!!document.querySelector('[data-draft-recovery]') && !!document.querySelector('[data-editor] input:not(:disabled)')");
  const recoveredDraft = await execute("return document.querySelector('[data-draft-recovery]').getAttribute('data-draft-recovery')");
  assert.ok(recoveredDraft.startsWith('draft-recovery/'));
  const operationalRoot = nativeDraft.slice(0, nativeDraft.indexOf('/operational/') + '/operational/'.length);
  assert.equal(await readFile(join(operationalRoot, recoveredDraft), 'utf8'), damagedDraft);
  await input('Native recovered creation'); await clickText('Сохранить');
  await until("!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry')].some(b=>b.textContent.includes('Native recovered creation'))");
  assert.equal(await readFile(join(operationalRoot, recoveredDraft), 'utf8'), damagedDraft);
  await assert.rejects(readFile(nativeDraft), { code: 'ENOENT' });
  await request('POST', `/session/${session}/window/rect`, { width: 1100, height: 800 });
  await execute("[...document.querySelectorAll('.entry:not(:disabled)')].find(b=>b.textContent.includes('Native recovered creation')).click()");
  await until("document.querySelector('.detail #record-title')?.textContent==='Native recovered creation'");
  await clickText('Удалить'); await until("!document.querySelector('.detail') && !document.querySelector('[data-editor]')");
  await clickText('Корзина'); await until("[...document.querySelectorAll('.trash-list h2')].some(h=>h.textContent==='Native recovered creation')");
  await clickText('Восстановить'); await until("document.querySelector('[data-trash] [role=status]')?.textContent==='Корзина пуста.'");
  await clickText('Назад'); await until("!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry:not(:disabled)')].some(b=>b.textContent.includes('Native recovered creation'))");
  await execute("[...document.querySelectorAll('.entry:not(:disabled)')].find(b=>b.textContent.includes('Native recovered creation')).click()");
  await until("document.querySelector('.detail #record-title')?.textContent==='Native recovered creation'");
  await clickText('Удалить'); await until("!document.querySelector('.detail') && !document.querySelector('[data-editor]')");
  await clickText('Корзина'); await until("!!document.querySelector('.trash-list h2')");
  await clickText('Удалить окончательно'); await clickText('Подтвердить окончательное удаление');
  await until("document.querySelector('[data-trash] [role=status]')?.textContent==='Корзина пуста.'");
  await selectOption('Срок хранения в корзине', 'Бессрочно'); await clickText('Сохранить срок хранения');
  await until("document.querySelector('[data-trash] fieldset select')?.value==='forever' && !document.querySelector('[data-trash] fieldset select').disabled && document.querySelector('[data-trash] fieldset button').disabled");
  await request('DELETE', `/session/${session}`); session = undefined; await start();
  await until("!!document.querySelector('[data-catalog=libraries]')");
  await clickText('Корзина');
  await until("document.querySelector('[data-trash] fieldset select')?.value==='forever' && document.querySelector('[data-trash] [role=status]')?.textContent==='Корзина пуста.'");
  await clickText('Назад'); await until("!document.querySelector('[data-editor]')");
  await clickText('+ Во входящие'); await input('Native attachment draft');
  await until("!!document.querySelector('[data-editor] input[type=file]:not(:disabled)')");
  await execute("const input=document.querySelector('[data-editor] input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([0,255,17,13,10,42])],'Native — документ.bin',{type:'application/octet-stream'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))");
  await until("document.querySelector('[data-editor] [data-attachment-id] .file-state')?.textContent==='Копия на этом устройстве'");
  const attachmentId = await execute("return document.querySelector('[data-editor] [data-attachment-id]').getAttribute('data-attachment-id')");
  const privateRoot = operationalRoot.slice(0, -'operational/'.length);
  const attachmentPath = join(privateRoot, 'attachments', attachmentId.slice(0,2), attachmentId);
  assert.deepEqual(await readFile(attachmentPath), Buffer.from([0,255,17,13,10,42]));
  await clickText('Закрыть'); await until("!document.querySelector('[data-editor]')");
  await request('DELETE', `/session/${session}`); session = undefined; await start();
  await clickText('+ Во входящие');
  await until(`!!document.querySelector('[data-editor] [data-attachment-id="${attachmentId}"]') && document.querySelector('[data-editor] textarea')?.value==='Native attachment draft'`);
  await clickText('Сохранить'); await until("!document.querySelector('[data-editor]') && [...document.querySelectorAll('.entry:not(:disabled)')].some(b=>b.textContent.includes('Native attachment draft'))");
  await execute("[...document.querySelectorAll('.entry:not(:disabled)')].find(b=>b.textContent.includes('Native attachment draft')).click()");
  await until(`document.querySelector('.detail [data-attachment-id="${attachmentId}"] .file-state')?.textContent==='Копия на этом устройстве'`);
  const binaryExport = join(directory, 'Native — документ.bin');
  assert.equal(await request('POST', `/session/${session}/execute/async`, { script: `const done=arguments[arguments.length-1];(async()=>{const invoke=window.__TAURI_INTERNALS__.invoke,facts=await invoke('binary_inspect',{id:'${attachmentId}'});await invoke('binary_export',{id:'${attachmentId}',path:${JSON.stringify(binaryExport)},...facts});})().then(()=>done('ok'),error=>done(String(error)));`, args: [] }), 'ok');
  assert.deepEqual(await readFile(binaryExport), await readFile(attachmentPath));
  await clickText('История записи'); await until("document.querySelectorAll('.history-versions button').length===1");
  console.log('PASS: Tauri WebView → shared TS → Rust/rusqlite and native attachment bytes; persisted after process restart');
} catch (error) {
  // Surface the assertion through the GitHub Checks API as well as runner logs.
  console.error('::error::' + String(error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  throw error;
} finally {
  if (session) await request('DELETE', `/session/${session}`).catch(() => {});
  driver.kill(); await delay(500); await rm(directory, { recursive: true, force: true });
}
