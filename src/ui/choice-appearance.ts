import type { Field, FieldConfig } from '../core/model';
import { fieldConfig } from '../core/validation';

export const choiceTones = ['green', 'amber', 'rose', 'red', 'cyan', 'violet'] as const;
type ChoiceTone = typeof choiceTones[number];
type ChoiceOption = NonNullable<FieldConfig['options']>[number] & { tone?: ChoiceTone };
export type ChoiceConfig = Omit<FieldConfig, 'options'> & { options?: ChoiceOption[]; choice_display?: 'initials'; toggle_display?: 'star' };

export function choiceConfig(field: Pick<Field, 'type' | 'config'>): ChoiceConfig {
  return fieldConfig(field) as ChoiceConfig;
}

export function choiceTone(option?: ChoiceOption): ChoiceTone | undefined {
  return choiceTones.find(tone => tone === option?.tone);
}
