import { Lexer, type Token, type MarkedToken } from 'marked';
import { decodeHTML } from 'entities';

export function markdownTokens(source: string): Token[] { return Lexer.lex(source, { gfm: true }); }
export function inlineText(tokens: readonly Token[]): string {
  return tokens.map(token => {
    const value = token as MarkedToken;
    if (value.type === 'list') return value.items.map(item => inlineText(item.tokens)).join(' ');
    if (value.type === 'table') return [...value.header,...value.rows.flat()].map(cell => inlineText(cell.tokens)).join(' ');
    if ('tokens' in value && value.tokens) return inlineText(value.tokens);
    if (value.type === 'br') return '\n';
    if (!('text' in value)) return '';
    return ['code','codespan','html','escape'].includes(value.type) ? value.text : decodeHTML(value.text);
  }).join('');
}
export function markdownText(source: string): string { return inlineText(Lexer.lexInline(source)); }
/** Only a recognizable first ATX heading is removed from the mapped body. Other syntax stays whole. */
export function splitInboxMarkdown(source: string): { title: string; body: string } {
  const heading = /^(?:\uFEFF)?(?:[ \t]*(?:\r\n|\n|\r))* {0,3}#{1,6}(?:[ \t]+|(?=\r\n|\n|\r|$))([^\r\n]*)(?:\r\n|\n|\r|$)/.exec(source);
  if (heading) return { title: markdownText(heading[1]!.replace(/[ \t]+#+[ \t]*$/, '').trim()), body: source.slice(heading[0].length) };
  return { title: markdownText(source.split(/\r\n|\n|\r/).find(line => line.trim())?.trim() ?? ''), body: source };
}
export function markdownPreview(source: string): string { return markdownTokens(source.slice(0, 2000)).map(token => inlineText([token])).join(' ').replace(/\s+/g, ' ').slice(0, 200); }
export function externalUrl(input: string): string | null {
  try { const url = new URL(input); return ['http:','https:','mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
