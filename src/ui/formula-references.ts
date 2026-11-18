import { parseFormula, printFormula } from '../core/formula';
import type { Field, FieldConfig } from '../core/model';
export function formulaReferenceLabel(field: Field, fields: readonly Field[]): string {
  if (field.name.includes('[') || field.name.includes(']') || /[\r\n]/.test(field.name)) return field.id;
  return fields.filter(other => other.collection_id === field.collection_id && other.name === field.name).length > 1 ? field.name + ' #' + field.id.slice(0,8) : field.name;
}
export function relatedFormulaCollection(field: Field, fields: readonly Field[]): string | undefined {
  const config = JSON.parse(field.config) as FieldConfig;
  return field.type === 'relation' ? config.target_collection_id : field.type === 'backlink' ? fields.find(source => source.id === config.source_field_id)?.collection_id : undefined;
}
export function localizeFormula(source: string, locale: string, fields: readonly Field[]): string {
  return printFormula(parseFormula(source),locale,id => { const field = fields.find(field => field.id === id); return field ? formulaReferenceLabel(field,fields) : id; });
}
export function canonicalizeFormula(source: string, locale: string, collectionId: string, fields: readonly Field[]): string {
  return printFormula(parseFormula(source,locale,(label,path) => {
    let collection: string | undefined = collectionId;
    for (const id of path) { const field = fields.find(field => field.id === id && field.collection_id === collection); collection = field ? relatedFormulaCollection(field,fields) : undefined; }
    const matches = fields.filter(field => field.collection_id === collection && field.type !== 'secret' && formulaReferenceLabel(field,fields) === label);
    return matches.length === 1 ? matches[0]!.id : '';
  }));
}
