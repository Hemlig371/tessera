import { AppError } from './errors';
import { canonical, UUID_RE, type FieldConfig, type JsonValue } from './model';
import { Decimal, normalizeDecimal } from './decimal';

export const decimalTypes = new Set(['decimal', 'money', 'duration']);
export const choiceTypes = new Set(['select', 'multiselect']);
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value);
}
export function normalizeFieldValue(type: string, value: JsonValue | undefined): JsonValue | undefined {
  if (value == null) return value;
  if (decimalTypes.has(type)) {
    if (typeof value !== 'string') throw new AppError('invalidDecimal');
    return normalizeDecimal(value);
  }
  if (type === 'coordinates' && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.latitude !== 'string' || typeof value.longitude !== 'string') throw new AppError('invalidCoordinates');
    return { ...value, latitude: normalizeDecimal(value.latitude), longitude: normalizeDecimal(value.longitude) };
  }
  return value;
}
export function validateAdditionalValue(type: string, value: JsonValue, config: FieldConfig): void {
  if (decimalTypes.has(type)) {
    if (typeof value !== 'string') throw new AppError('invalidDecimal');
    const number = Decimal.parse(normalizeDecimal(value));
    if ((type === 'duration' && number.compare(Decimal.parse('0')) < 0) ||
      (config.decimal_min != null && number.compare(Decimal.parse(config.decimal_min)) < 0) ||
      (config.decimal_max != null && number.compare(Decimal.parse(config.decimal_max)) > 0)) throw new AppError('outOfRange');
  }
  if (choiceTypes.has(type)) {
    const ids = type === 'multiselect' ? value : [value];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !UUID_RE.test(id) || !config.options?.some(option => option.id === id))) throw new AppError('invalidChoice');
  }
  if (type === 'secret' && typeof value !== 'string') throw new AppError('invalidData');
  if (type === 'time' && (typeof value !== 'string' || !validTime(value))) throw new AppError('invalidTime');
  if (type === 'local_datetime' && (typeof value !== 'string' || !value.includes('T') || !validDate(value.split('T')[0]!) || !validTime(value.split('T')[1]!) || value.split('T').length !== 2)) throw new AppError('invalidTime');
  if (type === 'date_range') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.start !== 'string' || typeof value.end !== 'string' ||
      !validDate(value.start) || !validDate(value.end) || value.start > value.end) throw new AppError('invalidDateRange');
  }
  if (type === 'coordinates') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.latitude !== 'string' || typeof value.longitude !== 'string') throw new AppError('invalidCoordinates');
    const latitude = Decimal.parse(value.latitude), longitude = Decimal.parse(value.longitude);
    if (latitude.compare(Decimal.parse('-90')) < 0 || latitude.compare(Decimal.parse('90')) > 0 || longitude.compare(Decimal.parse('-180')) < 0 || longitude.compare(Decimal.parse('180')) > 0) throw new AppError('invalidCoordinates');
  }
  if (type === 'url') {
    if (typeof value !== 'string') throw new AppError('invalidUrl');
    try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { throw new AppError('invalidUrl'); }
  }
  if (type === 'email' && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new AppError('invalidEmail');
  if (type === 'phone' && (typeof value !== 'string' || !/^\+?[\d ()-]{3,40}$/.test(value))) throw new AppError('invalidPhone');
  if (type === 'color' && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw new AppError('invalidAppearance');
  if (type === 'icon' && (typeof value !== 'string' || [...value].length > 16)) throw new AppError('invalidAppearance');
  if (type === 'json') canonical(value);
}
