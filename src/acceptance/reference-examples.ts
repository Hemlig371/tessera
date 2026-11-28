import type { Repository } from '../core/repository';
import type { ChoiceConfig } from '../ui/choice-appearance';
import type { UiDefinition } from '../core/model';

const artwork = import.meta.glob<string>('./artwork/*.webp', { import: 'default', eager: true });
async function attachCover(api: Repository, collection: string, owner: string, name: string) {
  const response = await fetch(artwork['./artwork/' + name + '.webp']!);
  if (!response.ok) throw new Error('fileError');
  const bytes = new Uint8Array(await response.arrayBuffer());
  return (await api.stageAttachment(collection, owner, {
    name: name + '.webp', mime: 'image/webp', size: bytes.length,
    read: async (offset, length) => bytes.slice(offset, offset + length),
  })).id;
}

const recipes = [
  ['Овсяная каша с ягодами', 'Завтрак', '15', 'Овсянка, молоко, ягоды, мёд', 'oats'],
  ['Лосось с овощами', 'Основное', '30', 'Лосось, брокколи, морковь, лимон', 'salmon'],
  ['Салат с авокадо', 'Салат', '10', 'Авокадо, томаты, зелень, оливковое масло', 'salad'],
  ['Чизкейк без выпечки', 'Десерт', '20', 'Творог, сливки, ягоды', 'cheesecake'],
  ['Тыквенный суп', 'Основное', '40', 'Тыква, сливки, лук, специи', 'soup'],
] as const;

export async function seedReferenceExamples(api: Repository, nutrition: string, projects: string) {
  const collection = await api.createCollection(nutrition, 'Рецепты', 'Название');
  await api.updateCollection(collection.id, {appearance:{icon:'🍃',color:'#3d8647'}});
  const options = ([['Завтрак', 'green'], ['Основное', 'amber'], ['Салат', 'green'], ['Десерт', 'rose']] as const)
    .map(([label, tone]) => ({label, tone, id:crypto.randomUUID()}));
  const field = (name: string, type: string, config = {}) => api.createField(collection.id, name, type, config);
  const photo = await field('Фото', 'image');
  const category = await field('Категория', 'select', {options});
  const time = await field('Время', 'duration');
  const portions = await field('Порции', 'integer');
  const excerpt = await field('Состав', 'text');
  const ingredients = await field('Ингредиенты', 'markdown');
  const steps = await field('Приготовление', 'markdown');
  const star = await field('Избранное', 'boolean', {toggle_display:'star'} satisfies ChoiceConfig);
  const fields = await api.listFields(collection.id);
  const publicIds = [photo.id,category.id,time.id,excerpt.id,collection.primary_field_id];
  const list: UiDefinition = {fields:fields.map(f => ({field_id:f.id,visible:publicIds.includes(f.id)})), list:{mode:'rows'},
    quick_actions:[{field_id:star.id,control:'toggle'}]};
  const profile = (await api.listDisplayProfiles(collection.id))[0]!;
  await api.updateDisplayProfile(profile.id, {name:'Все',definition:list});
  for (const [index, name] of [[0,'Завтраки'],[1,'Основные блюда'],[3,'Десерты']] as const) {
    await api.createDisplayProfile(collection.id, name, {...list, list:{mode:'rows', filters:[{field_id:category.id,op:'eq',value:options[index]!.id}]}});
  }
  const properties = [category.id,time.id,portions.id,ingredients.id,steps.id];
  await api.saveUiConfig(collection.id,'card',{fields:fields.map(f => ({field_id:f.id,visible:properties.includes(f.id)})),quick_actions:list.quick_actions});
  for (const [name, label, minutes, summary, asset] of [...recipes].reverse()) {
    const owner = crypto.randomUUID();
    const parts = asset === 'oats' ? ['Овсяные хлопья — 100 г','Молоко — 300 мл','Ягоды — 100 г','Мёд — по вкусу'] : summary.split(', ');
    const instructions: Record<string,string> = {
      oats:'1. Вскипятить молоко.\n2. Добавить овсяные хлопья и варить 5–7 минут.\n3. Снять с огня, добавить ягоды и мёд.',
      salmon:'1. Нарезать овощи.\n2. Запечь рыбу и овощи.\n3. Подать с лимоном.',
      salad:'1. Нарезать овощи и авокадо.\n2. Добавить зелень и масло.',
      cheesecake:'1. Взбить творог со сливками.\n2. Охладить в форме.\n3. Украсить ягодами.',
      soup:'1. Потушить тыкву и лук.\n2. Добавить сливки и измельчить блендером.',
    };
    await api.saveNewEntry(collection.id, {[collection.primary_field_id]:name,[category.id]:options.find(o=>o.label===label)!.id,
      [time.id]:String(Number(minutes)*60),[portions.id]:2,[excerpt.id]:summary,[star.id]:asset==='salmon',
      [ingredients.id]:parts.map(part=>'- [ ] '+part).join('\n'),[steps.id]:instructions[asset]!,
      [photo.id]:[await attachCover(api,collection.id,owner,asset)]},owner);
  }
  await api.saveLibraryNavigation(nutrition,{start:{kind:'collection',collection_id:collection.id},collections_layout:'list'});
  const release = await api.createCollection(projects,'Обновления','Название');
  const statuses = ['В работе','Готово'].map(label=>({id:crypto.randomUUID(),label}));
  const status = await api.createField(release.id,'Статус','select',{options:statuses});
  const priorities: ChoiceConfig = {options:[{id:crypto.randomUUID(),label:'Высокий',tone:'red'},{id:crypto.randomUUID(),label:'Обычный'}]};
  const priority = await api.createField(release.id,'Приоритет','select',priorities);
  const due = await api.createField(release.id,'Срок','date');
  const people = ([['Анна', 'cyan'], ['Кирилл', 'violet']] as const).map(([label, tone]) => ({id:crypto.randomUUID(),label,tone}));
  const participantChoices: ChoiceConfig = {options:people, choice_display:'initials'};
  const participants = await api.createField(release.id,'Участники','multiselect',participantChoices);
  const description = await api.createField(release.id,'Описание','multiline');
  const tasks = await api.createField(release.id,'Подзадачи','markdown');
  const image = await api.createField(release.id,'Обложка','image');
  const files = await api.createField(release.id,'Вложения','file',{multiple:true});
  const taskStarConfig: ChoiceConfig = {toggle_display:'star'};
  const taskStar = await api.createField(release.id,'Избранное','boolean',taskStarConfig);
  const owner = crypto.randomUUID();
  const cover = await attachCover(api,release.id,owner,'mountains');
  const imageAttachment = await attachCover(api,release.id,owner,'mountains');
  const bytes = new TextEncoder().encode('# План релиза\n\n- Проверка интерфейса\n- Подготовка сборок');
  const document = await api.stageAttachment(release.id,owner,{name:'план-v4.md',mime:'text/markdown',size:bytes.length,read:async (offset,length)=>bytes.slice(offset,offset+length)});
  await api.saveNewEntry(release.id,{[release.primary_field_id]:'Обновление Tessera v4.0',[status.id]:statuses[0]!.id,
    [priority.id]:JSON.parse(priority.config).options[0].id,[due.id]:'2025-01-28',
    [description.id]:'Завершить переработку интерфейса, провести тестирование и подготовить релиз v4.0.',
    [participants.id]:people.map(person=>person.id),
    [tasks.id]:'- [x] Новый дизайн основных экранов\n- [x] Адаптация для Android\n- [ ] Тестирование\n- [ ] Подготовка релиза',[image.id]:[cover],[files.id]:[imageAttachment,document.id]},owner);
  await api.saveUiConfig(release.id,'card',{fields:(await api.listFields(release.id)).map(f=>({
    field_id:f.id,visible:![release.primary_field_id,image.id,taskStar.id].includes(f.id)
  })),quick_actions:[{field_id:taskStar.id,control:'toggle'}]});
  await api.saveLibraryNavigation(projects,{start:{kind:'collection',collection_id:release.id},collections_layout:'list'});
}
