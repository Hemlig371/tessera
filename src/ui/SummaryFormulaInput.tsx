import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formulaFunctions, printFormula } from '../core/formula';
import { formatDecimal } from '../core/decimal';
import type { Field, JsonValue } from '../core/model';
import { canonicalizeFormula, formulaReferenceLabel, localizeFormula, relatedFormulaCollection } from './formula-references';
import { errorKey } from './common';

export function SummaryFormulaInput({ fields, collectionId, value, change, preview, busy }: {
  fields: readonly Field[]; collectionId: string; value: string; change: (source: string) => void; preview: (source: string) => Promise<JsonValue>; busy: boolean;
}) {
  const { t, i18n } = useTranslation(), current = useRef(value), revision = useRef(0), input = useRef<HTMLTextAreaElement>(null), caret = useRef<number | null>(null);
  const [source,setSource] = useState(value),[issue,setIssue] = useState<string | null>(null),[result,setResult] = useState(''),[reference,setReference] = useState(''),[leaf,setLeaf] = useState(''),[fn,setFn] = useState('SUM');
  useEffect(() => { current.current = value; },[value]);
  useEffect(() => { try { if (current.current) setSource(localizeFormula(current.current,i18n.language,fields)); } catch (error) { setIssue(errorKey(error)); } },[fields,i18n.language,collectionId]);
  useLayoutEffect(() => { if (caret.current != null && input.current) { input.current.focus(); input.current.setSelectionRange(caret.current,caret.current); caret.current = null; } },[source]);
  useEffect(() => {
    if (!value) return;
    let active = true; const expected = revision.current;
    const timer = setTimeout(() => { void preview(value).then(value => {
      if (!active || expected !== revision.current) return;
      let text = value == null ? t('unset') : typeof value === 'boolean' ? t(value ? 'yes' : 'no') : typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (typeof value === 'string') try { text = formatDecimal(value,i18n.language); } catch { /* Formula may return localized text. */ }
      setResult(text);setIssue(null);
    }).catch(error => { if (active && expected === revision.current) { setIssue(errorKey(error));setResult(''); } }); },200);
    return () => { active = false;clearTimeout(timer); };
  },[value,preview,i18n.language,t]);
  function update(text: string) {
    revision.current++; setSource(text);
    try { const canonical = canonicalizeFormula(text,i18n.language,collectionId,fields);change(canonical);setIssue(null);input.current?.setCustomValidity(''); }
    catch (error) { const code = errorKey(error);setIssue(code);input.current?.setCustomValidity(t('errors.'+code)); }
  }
  function insert(text: string,inside = false) {
    const start = input.current?.selectionStart ?? source.length,end = input.current?.selectionEnd ?? start;
    caret.current = start + text.length - (inside ? 1 : 0);update(source.slice(0,start) + text + source.slice(end));
  }
  const available = fields.filter(field => field.collection_id === collectionId && !['secret','file','image','json','coordinates','date_range','multiselect'].includes(field.type));
  const first = fields.find(field => field.id === reference),target = first ? relatedFormulaCollection(first,fields) : undefined;
  return <section className="formula-editor" aria-label={t('formulaEditor')}>
    <label>{t('formulaExpression')}<textarea ref={input} required disabled={busy} rows={4} spellCheck={false} data-testid="summary-formula-expression" value={source} onChange={event => update(event.target.value)} /></label>
    <label>{t('formulaField')}<select disabled={busy} value={reference} onChange={event => { setReference(event.target.value);setLeaf(''); }}><option value="">{t('chooseField')}</option>{available.map(field => <option key={field.id} value={field.id}>{formulaReferenceLabel(field,fields)}</option>)}</select></label>
    {target && <label>{t('formulaRelatedField')}<select disabled={busy} value={leaf} onChange={event => setLeaf(event.target.value)}><option value="">{t('chooseField')}</option>{fields.filter(field => field.collection_id === target && field.type !== 'secret').map(field => <option key={field.id} value={field.id}>{formulaReferenceLabel(field,fields)}</option>)}</select></label>}
    <button type="button" disabled={busy || !first} onClick={() => { if (first) insert('['+formulaReferenceLabel(first,fields)+']'+(leaf ? '.['+formulaReferenceLabel(fields.find(field => field.id === leaf)!,fields)+']' : '')); }}>{t('insertField')}</button>
    <label>{t('formulaFunction')}<select disabled={busy} value={fn} onChange={event => setFn(event.target.value)}>{formulaFunctions.map(fn => <option key={fn} value={fn}>{printFormula({ kind: 'call',name: fn,args: [] },i18n.language).slice(0,-2)}</option>)}</select></label>
    <button type="button" disabled={busy} onClick={() => insert(printFormula({ kind: 'call',name: fn,args: [] },i18n.language),true)}>{t('insertFunction')}</button>
    <p className="screen-hint">{t('summaryFormulaHint')}</p><p>{t('preview')}: <output data-testid="summary-formula-preview" className={issue ? 'formula-error' : undefined}>{issue ? t('errors.'+issue,{ defaultValue: t('errors.formulaType') }) : result || t('calculating')}</output></p>
  </section>;
}
