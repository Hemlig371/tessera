import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formulaFunctions, parseFormula, printFormula } from '../core/formula';
import { fieldConfig } from '../core/validation';
import type { Field, FieldConfig } from '../core/model';
import type { Repository } from '../core/repository';
import { errorKey } from './common';
import { formatDecimal } from '../core/decimal';

function nextCollection(field: Field, fields: Field[]): string | undefined {
  if (field.type === 'relation') return fieldConfig(field).target_collection_id;
  if (field.type === 'backlink') return fields.find(source => source.id === fieldConfig(field).source_field_id)?.collection_id;
}
function referenceLabel(field: Field, fields: Field[]): string {
  if (field.name.includes('[') || field.name.includes(']') || /[\r\n]/.test(field.name)) return field.id;
  return fields.filter(other => other.collection_id === field.collection_id && other.name === field.name).length > 1 ? field.name + ' #' + field.id.slice(0, 8) : field.name;
}
export function FormulaEditor({ api, collectionId, value, resultType, change, disabled }: {
  api: Repository; collectionId: string; value: string; resultType: FieldConfig['result_type']; change: (value: string) => void; disabled: boolean;
}) {
  const { t, i18n } = useTranslation(), initial = useRef(value), input = useRef<HTMLTextAreaElement>(null);
  const revision = useRef(0), caret = useRef<number | null>(null);
  const [fields, setFields] = useState<Field[]>([]), [loaded, setLoaded] = useState(false), [text, setText] = useState(value),
    [issue, setIssue] = useState<string | null>(null), [preview, setPreview] = useState(''),
    [reference, setReference] = useState(''), [leaf, setLeaf] = useState(''), [fn, setFn] = useState<string>('SUM');
  useEffect(() => { initial.current = value; }, [value]);
  useLayoutEffect(() => { if (caret.current != null && input.current) { input.current.focus(); input.current.setSelectionRange(caret.current, caret.current); caret.current = null; } }, [text]);
  useEffect(() => {
    let active = true;
    void api.formulaCatalog(collectionId).then(catalog => {
      if (!active) return;
      setFields(catalog); setLoaded(true);
      if (initial.current) try { setText(printFormula(parseFormula(initial.current), i18n.language, id => { const field = catalog.find(field => field.id === id); return field ? referenceLabel(field, catalog) : id; })); } catch (error) { setIssue(errorKey(error)); }
    }).catch(error => { if (active) setIssue(errorKey(error)); });
    return () => { active = false; };
  }, [api, collectionId, i18n.language]);
  function canonical(source: string) {
    return printFormula(parseFormula(source, i18n.language, (label, path) => {
      let collection: string | undefined = collectionId;
      for (const id of path) { const field = fields.find(field => field.id === id && field.collection_id === collection); collection = field ? nextCollection(field, fields) : undefined; }
      const choices = fields.filter(field => field.collection_id === collection && field.type !== 'secret' && referenceLabel(field, fields) === label);
      return choices.length === 1 ? choices[0]!.id : '';
    }));
  }
  function update(source: string) {
    revision.current++;
    setText(source);
    try { change(canonical(source)); input.current?.setCustomValidity(''); setIssue(null); }
    catch (error) { setIssue(errorKey(error)); input.current?.setCustomValidity(t('errors.' + errorKey(error))); }
  }
  useEffect(() => {
    if (!loaded || !value) return;
    let active = true;
    const expected = revision.current;
    const timer = setTimeout(() => {
      void api.previewFormula(collectionId, value, resultType).then(result => { if (active && expected === revision.current) { setIssue(null); setPreview(result === null ? t('unset') : resultType === 'decimal' && typeof result === 'string' ? formatDecimal(result, i18n.language) : typeof result === 'object' ? JSON.stringify(result) : String(result)); } }).catch(error => { if (active && expected === revision.current) { setIssue(errorKey(error)); setPreview(''); } });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, collectionId, i18n.language, loaded, resultType, t, value]);
  function insert(fragment: string, within = false) {
    const start = input.current?.selectionStart ?? text.length, end = input.current?.selectionEnd ?? start;
    caret.current = start + fragment.length - (within ? 1 : 0);
    update(text.slice(0, start) + fragment + text.slice(end));
  }
  const first = fields.find(field => field.id === reference), target = first ? nextCollection(first, fields) : undefined;
  const available = fields.filter(field => field.collection_id === collectionId && !['secret', 'file', 'image', 'json', 'coordinates', 'date_range'].includes(field.type));
  return <section className="formula-editor" aria-label={t('formulaEditor')}>
    <label>{t('formulaExpression')}<textarea ref={input} data-testid="formula-expression" disabled={disabled || !loaded} required rows={4} spellCheck={false} value={text} onChange={event => update(event.target.value)} /></label>
    <div className="field-grid"><label>{t('formulaField')}<select disabled={disabled || !loaded} value={reference} onChange={event => { setReference(event.target.value); setLeaf(''); }}><option value="">{t('chooseField')}</option>{available.map(field => <option key={field.id} value={field.id}>{referenceLabel(field, fields)}</option>)}</select></label>
      {target && <label>{t('formulaRelatedField')}<select disabled={disabled} value={leaf} onChange={event => setLeaf(event.target.value)}><option value="">{t('chooseField')}</option>{fields.filter(field => field.collection_id === target && !['secret', 'file', 'image', 'json', 'coordinates', 'date_range'].includes(field.type)).map(field => <option key={field.id} value={field.id}>{referenceLabel(field, fields)}</option>)}</select></label>}
    </div>
    <button type="button" disabled={disabled || !first} onClick={() => { if (first) insert('[' + referenceLabel(first, fields) + ']' + (leaf ? '.[' + referenceLabel(fields.find(field => field.id === leaf)!, fields) + ']' : '')); }}>{t('insertField')}</button>
    <label>{t('formulaFunction')}<select disabled={disabled} value={fn} onChange={event => setFn(event.target.value)}>{formulaFunctions.map(name => <option key={name} value={name}>{printFormula({ kind: 'call', name, args: [] }, i18n.language).slice(0, -2)}</option>)}</select></label>
    <button type="button" disabled={disabled || !loaded} onClick={() => insert(printFormula({ kind: 'call', name: fn, args: [] }, i18n.language), true)}>{t('insertFunction')}</button>
    <p className="screen-hint">{t('formulaSyntaxHint')}</p><p className="screen-hint">{t('formulaDynamicHint')}</p>
    <p>{t('formulaPreviewFirstEntry')}: <output data-testid="formula-preview" className={issue ? 'formula-error' : undefined}>{issue ? t('errors.' + issue, { defaultValue: t('errors.formulaType') }) : preview || t('calculating')}</output></p>
  </section>;
}
