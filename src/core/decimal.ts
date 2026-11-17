import { AppError } from './errors';

const power = (n: number) => 10n ** BigInt(n);
const limit = 9223372036854775807n;
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b) { const rest = a % b; a = b; b = rest; }
  return a || 1n;
}

/** Exact rational intermediates; half-up rounding only at explicit boundaries. */
export class Decimal {
  readonly numerator: bigint;
  readonly denominator: bigint;
  constructor(numerator: bigint, denominator = 1n) {
    if (!denominator) throw new AppError('divisionByZero');
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    const divisor = gcd(numerator, denominator);
    this.numerator = numerator / divisor; this.denominator = denominator / divisor;
    if (this.numerator.toString(2).length > 4096 || this.denominator.toString(2).length > 4096) throw new AppError('decimalOverflow');
  }
  static parse(value: string): Decimal {
    if (typeof value !== 'string' || value.length > 256 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new AppError('invalidDecimal');
    const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
    return new Decimal(BigInt((whole || '0') + fraction) * (value.startsWith('-') ? -1n : 1n), power(fraction.length));
  }
  add(other: Decimal) { return new Decimal(this.numerator * other.denominator + other.numerator * this.denominator, this.denominator * other.denominator); }
  subtract(other: Decimal) { return this.add(other.negate()); }
  multiply(other: Decimal) { return new Decimal(this.numerator * other.numerator, this.denominator * other.denominator); }
  divide(other: Decimal) { return new Decimal(this.numerator * other.denominator, this.denominator * other.numerator); }
  negate() { return new Decimal(-this.numerator, this.denominator); }
  compare(other: Decimal): number {
    const difference = this.numerator * other.denominator - other.numerator * this.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  scaled(places = 5): bigint {
    if (!Number.isInteger(places) || places < 0 || places > 20) throw new AppError('invalidDecimal');
    const sign = this.numerator < 0n ? -1n : 1n, absolute = this.numerator * sign * power(places);
    return sign * (absolute / this.denominator + (absolute % this.denominator * 2n >= this.denominator ? 1n : 0n));
  }
  round(places: number) { return new Decimal(this.scaled(places), power(places)); }
  toString(places = 5, fixed = false): string {
    const scaled = this.scaled(places), digits = (scaled < 0n ? -scaled : scaled).toString().padStart(places + 1, '0');
    const fraction = places ? digits.slice(-places) : '';
    const trimmed = fixed ? fraction : fraction.replace(/0+$/, '');
    return (scaled < 0n ? '-' : '') + (places ? digits.slice(0, -places) : digits) + (trimmed ? '.' + trimmed : '');
  }
}

/** A fixed-width offset integer TEXT key preserves exact order in SQLite/JSON. */
export function decimalKey(value: string): string {
  const scaled = Decimal.parse(value).scaled();
  if (scaled < -limit || scaled > limit) throw new AppError('decimalOverflow');
  return (scaled + limit).toString().padStart(20, '0');
}
export function normalizeDecimal(value: string): string {
  const normalized = Decimal.parse(value).toString();
  decimalKey(normalized);
  return normalized;
}
export function formatDecimal(value: string, locale: string, places?: number): string {
  const normalized = Decimal.parse(value).toString(places ?? 5, places != null);
  const [integer, fraction] = normalized.split('.');
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
  // BigInt keeps long amounts exact; Number is never used for user arithmetic.
  return (integer === '-0' ? '-' : '') + new Intl.NumberFormat(locale).format(BigInt(integer!)) + (fraction ? separator + fraction : '');
}
