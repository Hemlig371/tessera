import { AppError } from './errors';
import { Decimal } from './decimal';
import { UUID_RE, localTimestamp } from './model';
import { validDate } from './field-values';

export type FormulaValue = Decimal | string | boolean | null | FormulaValue[];
export type Expression = { kind: 'number'; value: string } | { kind: 'literal'; value: string | boolean | null } |
  { kind: 'reference'; path: string[] } | { kind: 'unary'; operator: string; operand: Expression } |
  { kind: 'binary'; operator: string; left: Expression; right: Expression } | { kind: 'call'; name: string; args: Expression[] };
export const formulaFunctions = ['IF', 'AND', 'OR', 'NOT', 'SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'MIN', 'MAX', 'ROUND',
  'CONCAT', 'LEN', 'LEFT', 'RIGHT', 'LOWER', 'UPPER', 'TRIM', 'SUBSTITUTE', 'DATE', 'YEAR', 'MONTH', 'DAY', 'NOW'] as const;
const russian: Record<string, string> = { IF: 'ЕСЛИ', AND: 'И', OR: 'ИЛИ', NOT: 'НЕ', SUM: 'СУММ', AVERAGE: 'СРЗНАЧ', COUNT: 'СЧЁТ', COUNTA: 'СЧЁТЗ', MIN: 'МИН', MAX: 'МАКС', ROUND: 'ОКРУГЛ',
  CONCAT: 'СЦЕПИТЬ', LEN: 'ДЛСТР', LEFT: 'ЛЕВСИМВ', RIGHT: 'ПРАВСИМВ', LOWER: 'СТРОЧН', UPPER: 'ПРОПИСН', TRIM: 'СЖПРОБЕЛЫ', SUBSTITUTE: 'ПОДСТАВИТЬ', DATE: 'ДАТА', YEAR: 'ГОД', MONTH: 'МЕСЯЦ', DAY: 'ДЕНЬ', NOW: 'ТДАТА' };
const aliases = new Map(Object.entries(russian).map(([name, localized]) => [localized.replaceAll('Ё', 'Е'), name]));
interface Token { kind: 'number' | 'string' | 'reference' | 'identifier' | 'operator' | 'end'; text: string }
const priorities: Record<string, number> = { '=': 1, '<>': 1, '!=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4 };
function tokens(source: string, locale: string): Token[] {
  if (typeof source !== 'string' || source.length > 8000) throw new AppError('formulaBudget');
  source = source.trim().replace(/^=/, '');
  const result: Token[] = [];
  for (let at = 0; at < source.length;) {
    const rest = source.slice(at);
    if (/^\s/.test(rest)) { at++; continue; }
    const numeric = rest.match(locale.startsWith('ru') ? /^(?:\d+(?:[.,]\d+)?|\.\d+)/ : /^(?:\d+(?:\.\d+)?|\.\d+)/);
    if (numeric) { const value = numeric[0].replace(',', '.'); Decimal.parse(value); result.push({ kind: 'number', text: value }); at += numeric[0].length; }
    else if (rest[0] === '[') {
      const end = rest.indexOf(']');
      if (end < 2 || end > 201 || /[\r\n]/.test(rest.slice(1, end)) || rest.slice(1, end).includes('[')) throw new AppError('formulaSyntax');
      result.push({ kind: 'reference', text: rest.slice(1, end) }); at += end + 1;
    } else if (rest[0] === '"') {
      let text = '', offset = 1, closed = false;
      while (offset < rest.length) {
        if (rest[offset] === '"') { if (rest[offset + 1] === '"') { text += '"'; offset += 2; continue; } offset++; closed = true; break; }
        text += rest[offset++];
      }
      if (!closed) throw new AppError('formulaSyntax');
      result.push({ kind: 'string', text }); at += offset;
    } else {
      const identifier = rest.match(/^[\p{L}_][\p{L}\p{N}_]*/u), operator = rest.match(/^(?:<>|!=|<=|>=|[+\-*/&=<>(),;.×÷])/);
      if (identifier) { result.push({ kind: 'identifier', text: identifier[0].toUpperCase() }); at += identifier[0].length; }
      else if (operator) { result.push({ kind: 'operator', text: operator[0] === '×' ? '*' : operator[0] === '÷' ? '/' : operator[0] === ';' ? ',' : operator[0] }); at += operator[0].length; }
      else throw new AppError('formulaSyntax');
    }
    if (result.length > 2048) throw new AppError('formulaBudget');
  }
  result.push({ kind: 'end', text: '' }); return result;
}
export function parseFormula(source: string, locale = 'canonical', resolve?: (name: string, path: string[]) => string): Expression {
  const stream = tokens(source, locale); let at = 0;
  const current = () => stream[at]!;
  const consume = (text: string) => { if (current().text !== text) throw new AppError('formulaSyntax'); at++; };
  function expression(minimum = 0, depth = 0): Expression {
    if (depth > 64) throw new AppError('formulaBudget');
    let left: Expression; const token = stream[at++]!;
    if (token.kind === 'number') {
      const [whole, fraction] = token.text.split('.');
      const tail = fraction?.replace(/0+$/, '');
      left = { kind: 'number', value: (whole || '0').replace(/^0+(?=\d)/, '') + (tail ? '.' + tail : '') };
    } else if (token.kind === 'string') left = { kind: 'literal', value: token.text };
    else if (token.text === '+' || token.text === '-') left = { kind: 'unary', operator: token.text, operand: expression(5, depth + 1) };
    else if (token.text === '(') { left = expression(0, depth + 1); consume(')'); }
    else if (token.kind === 'reference') {
      const path: string[] = [], push = (text: string) => {
        const id = UUID_RE.test(text) ? text.toLowerCase() : resolve?.(text, path);
        if (!id || !UUID_RE.test(id)) throw new AppError('formulaReference'); path.push(id);
      };
      push(token.text);
      while (current().text === '.') { consume('.'); const next = stream[at++]!; if (next.kind !== 'reference') throw new AppError('formulaSyntax'); push(next.text); }
      if (path.length > 8) throw new AppError('formulaBudget');
      left = { kind: 'reference', path };
    } else if (token.kind === 'identifier') {
      const name = aliases.get(token.text.replaceAll('Ё', 'Е')) ?? token.text;
      if (['TRUE', 'ИСТИНА', 'FALSE', 'ЛОЖЬ', 'NULL', 'ПУСТО'].includes(name)) left = { kind: 'literal', value: ['TRUE', 'ИСТИНА'].includes(name) ? true : ['FALSE', 'ЛОЖЬ'].includes(name) ? false : null };
      else {
        if (!(formulaFunctions as readonly string[]).includes(name)) throw new AppError('formulaName');
        consume('('); const args: Expression[] = [];
        if (current().text !== ')') for (;;) { args.push(expression(0, depth + 1)); if (current().text !== ',') break; consume(','); }
        consume(')'); left = { kind: 'call', name, args };
      }
    } else throw new AppError('formulaSyntax');
    while (Object.hasOwn(priorities, current().text) && priorities[current().text]! >= minimum) {
      const operator = stream[at++]!.text;
      left = { kind: 'binary', operator: operator === '!=' ? '<>' : operator, left, right: expression(priorities[operator]! + 1, depth + 1) };
    }
    return left;
  }
  const result = expression(); if (current().kind !== 'end') throw new AppError('formulaSyntax'); return result;
}
export function printFormula(expression: Expression, locale = 'canonical', label?: (id: string, path: string[]) => string): string {
  const ru = locale.startsWith('ru');
  switch (expression.kind) {
    case 'number': return ru ? expression.value.replace('.', ',') : expression.value;
    case 'literal': return typeof expression.value === 'string' ? '"' + expression.value.replaceAll('"', '""') + '"' : expression.value === null ? 'NULL' : expression.value ? 'TRUE' : 'FALSE';
    case 'reference': return expression.path.map((id, index, path) => '[' + (label?.(id, path.slice(0, index)) ?? id) + ']').join('.');
    case 'unary': return expression.operator + '(' + printFormula(expression.operand, locale, label) + ')';
    case 'binary': return '(' + printFormula(expression.left, locale, label) + expression.operator + printFormula(expression.right, locale, label) + ')';
    case 'call': return (ru ? russian[expression.name] ?? expression.name : expression.name) + '(' + expression.args.map(arg => printFormula(arg, locale, label)).join(ru ? ';' : ',') + ')';
  }
}
export function formulaReferences(expression: Expression): string[][] {
  if (expression.kind === 'reference') return [expression.path];
  if (expression.kind === 'unary') return formulaReferences(expression.operand);
  if (expression.kind === 'binary') return [...formulaReferences(expression.left), ...formulaReferences(expression.right)];
  return expression.kind === 'call' ? expression.args.flatMap(formulaReferences) : [];
}
export function formulaDynamic(expression: Expression): boolean {
  if (expression.kind === 'call') return expression.name === 'NOW' || expression.args.some(formulaDynamic);
  if (expression.kind === 'binary') return formulaDynamic(expression.left) || formulaDynamic(expression.right);
  return expression.kind === 'unary' && formulaDynamic(expression.operand);
}
function numeric(value: FormulaValue): Decimal { if (!(value instanceof Decimal)) throw new AppError('formulaType'); return value; }
function boolean(value: FormulaValue): boolean { if (value === null) return false; if (typeof value !== 'boolean') throw new AppError('formulaType'); return value; }
function string(value: FormulaValue): string { if (typeof value !== 'string') throw new AppError('formulaType'); return value; }
function integer(value: FormulaValue, minimum: number, maximum: number): number {
  const n = numeric(value); if (n.denominator !== 1n || n.numerator < BigInt(minimum) || n.numerator > BigInt(maximum)) throw new AppError('formulaType'); return Number(n.numerator);
}
function flatten(values: FormulaValue[]): FormulaValue[] {
  const result: FormulaValue[] = [];
  function append(items: FormulaValue[]) { for (const item of items) { if (Array.isArray(item)) append(item); else { if (result.length >= 100000) throw new AppError('formulaBudget'); result.push(item); } } }
  append(values); return result;
}
function text(value: FormulaValue): string {
  const result = value === null ? '' : value instanceof Decimal ? value.toString() : typeof value === 'boolean' ? value ? 'TRUE' : 'FALSE' : string(value);
  if (result.length > 1024 * 1024) throw new AppError('formulaBudget'); return result;
}

export async function evaluateFormula(expression: Expression, context: { resolve: (path: string[]) => Promise<FormulaValue>; now?: () => Date }): Promise<FormulaValue> {
  let budget = 4096;
  async function evaluate(node: Expression): Promise<FormulaValue> {
    if (--budget < 0) throw new AppError('formulaBudget');
    if (node.kind === 'number') return Decimal.parse(node.value);
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'reference') return context.resolve(node.path);
    if (node.kind === 'unary') { const value = await evaluate(node.operand); return value === null ? null : node.operator === '-' ? numeric(value).negate() : numeric(value); }
    if (node.kind === 'binary') {
      const left = await evaluate(node.left), right = await evaluate(node.right);
      if (node.operator === '&') { const a = text(left), b = text(right); if (a.length + b.length > 1024 * 1024) throw new AppError('formulaBudget'); return a + b; }
      if (['+', '-', '*', '/'].includes(node.operator)) {
        if (left === null || right === null) return null;
        const a = numeric(left), b = numeric(right);
        return node.operator === '+' ? a.add(b) : node.operator === '-' ? a.subtract(b) : node.operator === '*' ? a.multiply(b) : a.divide(b);
      }
      let comparison: number;
      if (left === null || right === null) {
        if (!['=', '<>'].includes(node.operator)) throw new AppError('formulaType'); comparison = left === right ? 0 : 1;
      } else if (left instanceof Decimal && right instanceof Decimal) comparison = left.compare(right);
      else if (typeof left === typeof right && !Array.isArray(left) && !Array.isArray(right) && !(left instanceof Decimal) && !(right instanceof Decimal)) comparison = left === right ? 0 : left < right ? -1 : 1;
      else throw new AppError('formulaType');
      return node.operator === '=' ? comparison === 0 : node.operator === '<>' ? comparison !== 0 : node.operator === '<' ? comparison < 0 : node.operator === '>' ? comparison > 0 : node.operator === '<=' ? comparison <= 0 : comparison >= 0;
    }
    const args = node.args, arity = (min: number, max = min) => { if (args.length < min || args.length > max) throw new AppError('formulaArguments'); };
    if (node.name === 'IF') { arity(3); return evaluate(boolean(await evaluate(args[0]!)) ? args[1]! : args[2]!); }
    if (node.name === 'AND' || node.name === 'OR') {
      arity(1, 256); for (const arg of args) { const value = boolean(await evaluate(arg)); if (node.name === 'AND' && !value) return false; if (node.name === 'OR' && value) return true; } return node.name === 'AND';
    }
    const values: FormulaValue[] = []; for (const arg of args) values.push(await evaluate(arg));
    const value = values[0] ?? null;
    if (node.name === 'NOT') { arity(1); return !boolean(value); }
    if (['SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'MIN', 'MAX'].includes(node.name)) {
      arity(0, 256); const all = flatten(values);
      if (node.name === 'COUNTA') return new Decimal(BigInt(all.filter(item => item !== null && item !== '').length));
      if (node.name === 'COUNT') return new Decimal(BigInt(all.filter(item => item instanceof Decimal).length));
      const numbers = all.filter(item => item !== null).map(numeric);
      if (!numbers.length) return node.name === 'SUM' ? new Decimal(0n) : null;
      if (node.name === 'MIN' || node.name === 'MAX') return numbers.reduce((a, b) => (a.compare(b) < 0) === (node.name === 'MIN') ? a : b);
      const sum = numbers.reduce((a, b) => a.add(b), new Decimal(0n)); return node.name === 'AVERAGE' ? sum.divide(new Decimal(BigInt(numbers.length))) : sum;
    }
    if (node.name === 'ROUND') {
      arity(1, 2); if (value === null) return null; const places = args.length === 2 ? integer(values[1]!, -10, 20) : 0;
      if (places >= 0) return numeric(value).round(places);
      const factor = new Decimal(10n ** BigInt(-places)); return numeric(value).divide(factor).round(0).multiply(factor);
    }
    if (node.name === 'CONCAT') { arity(0, 256); const parts = flatten(values).map(text); if (parts.reduce((length, part) => length + part.length, 0) > 1024 * 1024) throw new AppError('formulaBudget'); return parts.join(''); }
    if (['LEN', 'LOWER', 'UPPER', 'TRIM'].includes(node.name)) {
      arity(1); const input = string(value);
      return node.name === 'LEN' ? new Decimal(BigInt([...input].length)) : node.name === 'LOWER' ? input.toLowerCase() : node.name === 'UPPER' ? input.toUpperCase() : input.trim().replace(/\s+/g, ' ');
    }
    if (node.name === 'LEFT' || node.name === 'RIGHT') { arity(1, 2); const input = [...string(value)], length = args.length === 1 ? 1 : integer(values[1]!, 0, 8000); return (node.name === 'LEFT' ? input.slice(0, length) : length ? input.slice(-length) : []).join(''); }
    if (node.name === 'SUBSTITUTE') { arity(3); const search = string(values[1]!); if (!search) throw new AppError('formulaType'); const parts = string(value).split(search), replacement = string(values[2]!); if (parts.reduce((length, part) => length + part.length, 0) + (parts.length - 1) * replacement.length > 1024 * 1024) throw new AppError('formulaBudget'); return parts.join(replacement); }
    if (node.name === 'NOW') { arity(0); return localTimestamp(context.now?.() ?? new Date()); }
    if (node.name === 'DATE') { arity(3); const date = String(integer(value, 1, 9999)).padStart(4, '0') + '-' + String(integer(values[1]!, 1, 12)).padStart(2, '0') + '-' + String(integer(values[2]!, 1, 31)).padStart(2, '0'); if (!validDate(date)) throw new AppError('formulaDate'); return date; }
    if (['YEAR', 'MONTH', 'DAY'].includes(node.name)) { arity(1); const date = string(value).slice(0, 10); if (!validDate(date)) throw new AppError('formulaDate'); return Decimal.parse(date.split('-')[node.name === 'YEAR' ? 0 : node.name === 'MONTH' ? 1 : 2]!); }
    throw new AppError('formulaName');
  }
  return evaluate(expression);
}
