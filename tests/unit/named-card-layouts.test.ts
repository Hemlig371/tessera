import { describe, expect, it } from 'vitest';
import type { Field, UiDefinition } from '../../src/core/model';
import { resolveCardLayout, validateUiDefinition } from '../../src/core/ui-definition';

const primary = crypto.randomUUID();
const fields = [{ id: primary, collection_id: crypto.randomUUID(), name: 'Title', type: 'text', config: '{}' }] as Field[];
const base: UiDefinition = { fields: [{ field_id: primary, visible: true }] };

describe('named card layouts', () => {
  it('resolves a per-view card without changing the legacy default', () => {
    const id = crypto.randomUUID();
    const alternate: UiDefinition = { fields: [{ field_id: primary, visible: true, collapsed: true }] };
    const card: UiDefinition = { ...base, named_cards: [{ id, name: 'Compact', definition: alternate }] };
    validateUiDefinition(card, 'card', fields, primary);
    expect(resolveCardLayout(card, id)).toBe(alternate);
    expect(resolveCardLayout(card, crypto.randomUUID())).toBe(card);
    expect(resolveCardLayout(card)).toBe(card);
    validateUiDefinition({ ...base, detail_layout_id: id }, 'list', fields, primary);
  });

  it('rejects duplicate names, invalid nesting and a layout link on a card', () => {
    const id = crypto.randomUUID();
    const duplicate: UiDefinition = {
      ...base, named_cards: [
        { id, name: 'Compact', definition: base },
        { id: crypto.randomUUID(), name: 'compact', definition: base },
      ],
    };
    expect(() => validateUiDefinition(duplicate, 'card', fields, primary)).toThrow('invalidUiConfig');
    expect(() => validateUiDefinition({ ...base, detail_layout_id: id }, 'card', fields, primary)).toThrow('invalidUiConfig');
    expect(() => validateUiDefinition({ ...base, named_cards: [{ id, name: 'Nested', definition: duplicate }] }, 'card', fields, primary)).toThrow('invalidUiConfig');
  });
});
