import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/core/decimal';
import { evaluateFormula, formulaDynamic, formulaReferences, parseFormula, printFormula, type FormulaValue } from '../../src/core/formula';

const field = '12345678-1234-4123-8123-123456789abc';
async function evaluate(source: string, value: FormulaValue = null) {
  const result = await evaluateFormula(parseFormula(source), { resolve: async () => value });
  return result instanceof Decimal ? result.toString() : result;
}
describe('safe canonical formulas', () => {
  it('canonicalizes localized functions, separators and named references to stable IDs', () => {
    const expression = parseFormula('=ЕСЛИ([Цена]>0; СУММ([Цена];1,5); 0)', 'ru', name => name === 'Цена' ? field : '');
    const canonical = printFormula(expression);
    expect(canonical).toBe(`IF(([${field}]>0),SUM([${field}],1.5),0)`);
    expect(printFormula(parseFormula(canonical))).toBe(canonical);
    expect(printFormula(expression, 'ru', () => 'Новая цена')).toBe('ЕСЛИ(([Новая цена]>0);СУММ([Новая цена];1,5);0)');
    expect(formulaReferences(expression)).toEqual([[field], [field]]);
  });
  it('uses exact intermediate arithmetic, precedence, comparison and lazy IF/booleans', async () => {
    expect(await evaluate('(0.1+0.2)*10/3')).toBe('1');
    expect(await evaluate('1/3*3')).toBe('1');
    expect(await evaluate('2+3*4')).toBe('14');
    expect(await evaluate('IF(2>1,ROUND(-1.005,2),1/0)')).toBe('-1.01');
    expect(await evaluate('AND(FALSE,1/0)')).toBe(false);
    expect(await evaluate('OR(TRUE,1/0)')).toBe(true);
    expect(await evaluate('ROUND(125,-1)')).toBe('130');
    expect(await evaluate('NULL+1')).toBe(null);
    expect(await evaluate('NULL=NULL')).toBe(true);
  });
  it('distinguishes NULL, explicit zero, numeric COUNT and nonempty COUNTA', async () => {
    expect(await evaluate(`SUM([${field}])`, [null, Decimal.parse('0'), Decimal.parse('2')])).toBe('2');
    expect(await evaluate(`AVERAGE([${field}])`, [null, Decimal.parse('0'), Decimal.parse('2')])).toBe('1');
    expect(await evaluate(`COUNT([${field}])`, [null, Decimal.parse('0'), 'text', false])).toBe('1');
    expect(await evaluate(`COUNTA([${field}])`, [null, Decimal.parse('0'), 'text', false, ''])).toBe('3');
    expect(await evaluate('SUM()')).toBe('0');
    expect(await evaluate('COUNT()')).toBe('0');
    expect(await evaluate('AVERAGE()')).toBe(null);
    expect(await evaluate('MIN()')).toBe(null);
    await expect(evaluate('SUM("wrong type")')).rejects.toThrow('formulaType');
  });
  it('implements Unicode text, literal dates and dynamic local NOW', async () => {
    expect(await evaluate('CONCAT(UPPER("ёж")," ",LEFT("🦔 мир",1)," ",LEN("🦔"))')).toBe('ЁЖ 🦔 1');
    expect(await evaluate('DATE(2024,2,29)')).toBe('2024-02-29');
    expect(await evaluate('YEAR(DATE(2024,2,29))+MONTH("2024-02-29")+DAY("2024-02-29")')).toBe('2055');
    const expression = parseFormula('CONCAT(NOW(),"!")'); expect(formulaDynamic(expression)).toBe(true);
    const now = () => new Date(2026, 10, 17, 12, 30, 0);
    expect(await evaluateFormula(expression, { resolve: async () => null, now })).toBe('2026-11-17T12:30:00.000!');
    await expect(evaluate('DATE(2023,2,29)')).rejects.toThrow('formulaDate');
  });
  it('rejects executable code, unknown names, malformed expressions and unbounded input', async () => {
    for (const source of ['process.exit()', 'eval("1")', '(()=>1)()', 'SUM(1,,2)', '1;DROP TABLE records', '"unterminated', '[unknown]']) {
      expect(() => parseFormula(source)).toThrow();
    }
    expect(() => parseFormula('('.repeat(70) + '1' + ')'.repeat(70))).toThrow('formulaBudget');
    expect(() => parseFormula('1'.repeat(9000))).toThrow('formulaBudget');
    await expect(evaluate('1/0')).rejects.toThrow('divisionByZero');
    await expect(evaluate('1+"1"')).rejects.toThrow('formulaType');
    await expect(evaluate('IF(TRUE,1)')).rejects.toThrow('formulaArguments');
  });
});
