import { AppError } from './errors';

/** Device-local preferences; never enter record versions or replication payloads. */
export interface DeviceAppearance {
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  font_scale: number;
}
export const defaultAppearance: DeviceAppearance = { theme: 'system', density: 'comfortable', font_scale: 1 };
export function validateAppearance(value: unknown): DeviceAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalidData');
  const input = value as Record<string, unknown>;
  if (!['system', 'light', 'dark'].includes(input.theme as string) ||
      !['comfortable', 'compact'].includes(input.density as string) ||
      typeof input.font_scale !== 'number' || ![1, 1.15, 1.3, 1.5].includes(input.font_scale)) throw new AppError('invalidData');
  return { theme: input.theme as DeviceAppearance['theme'], density: input.density as DeviceAppearance['density'], font_scale: input.font_scale };
}
