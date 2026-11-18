import { describe, expect, it } from 'vitest';
import { KanbanProjection } from '../../src/core/kanban-projection';
import { modeFields, validateModeOptions } from '../../src/core/mode-options';
import type { EntryListItem, Field } from '../../src/core/model';
const entry = (id: string, value: EntryListItem['data'][string]) => ({ id, title: id, data: { status: value } } as unknown as EntryListItem);
describe('M3 Kanban projection and mode applicability', () => {
  it('preserves stable, archived, unknown and unassigned options, with whole-query counts and bounded previews', () => {
    const board = new KanbanProjection({ id: 'status', type: 'select', config: JSON.stringify({ options: [{ id: 'active', label: 'Новая' }, { id: 'old', label: 'Архив', archived: true }] }) }, 2);
    for (let i = 0; i < 211; i++) board.add(entry(String(i), 'active'));
    board.add(entry('archived','old')); board.add(entry('future','unknown')); board.add(entry('empty',null));
    expect(board.columns.map(column => [column.value,column.count,column.entries.length])).toEqual([[null,1,1],['active',211,2],['old',1,1],['unknown',1,1]]);
    expect(board.columns.find(column => column.value === 'old')!.archived).toBe(true);
    expect(board.columns.find(column => column.value === 'unknown')!.unknown).toBe(true);
  });
  it('keeps false separate from NULL and exposes invalid values', () => {
    const board = new KanbanProjection({ id: 'status', type: 'boolean', config: '{}' });
    board.add(entry('false',false)); board.add(entry('true',true)); board.add(entry('none',null));
    expect(board.columns.map(column => [column.value,column.count])).toEqual([[null,1],[false,1],[true,1]]);
    expect(() => board.add(entry('wrong',0))).toThrow('invalidData');
  });
  it('requires an applicable field in the same collection and a single self relation for tree', () => {
    const field = (id: string, type: string, config: object = {}, collection_id = 'tasks') => ({ id, type, config: JSON.stringify(config), collection_id } as Field);
    const fields = [field('status','select'),field('date','date'),field('parent','relation',{ target_collection_id: 'tasks' }),field('multi','relation',{ target_collection_id: 'tasks', multiple: true }),field('external','relation',{ target_collection_id: 'other' }),field('secret','secret'),field('foreign','select',{},'other')];
    expect(modeFields('kanban',fields,'tasks').map(field => field.id)).toEqual(['status']);
    expect(modeFields('calendar',fields,'tasks').map(field => field.id)).toEqual(['date']);
    expect(modeFields('tree',fields,'tasks').map(field => field.id)).toEqual(['parent']);
    expect(() => validateModeOptions({ mode: 'tree', mode_field: 'parent' },fields,'tasks')).not.toThrow();
    expect(() => validateModeOptions({ mode: 'tree', mode_field: 'multi' },fields,'tasks')).toThrow('invalidUiConfig');
    expect(() => validateModeOptions({ mode: 'calendar', mode_field: 'secret' },fields,'tasks')).toThrow('invalidUiConfig');
  });
});
