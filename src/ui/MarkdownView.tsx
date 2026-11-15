import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Token, MarkedToken, Tokens } from 'marked';
import { decodeHTML } from 'entities';
import { externalUrl, inlineText, markdownTokens } from '../core/markdown';
import { openExternalUrl } from '../platform/external-actions';

/** Render the parser's tokens as React nodes. Raw HTML is always literal text. */
export function MarkdownView({ source }: { source: string }) {
  const { t } = useTranslation(), [failed, setFailed] = useState(false);
  const tokens = useMemo(() => markdownTokens(source), [source]);
  function link(href: string, children: ReactNode, title?: string | null): ReactNode {
    const url = externalUrl(href);
    return url ? <a href={url} title={title ? decodeHTML(title) : undefined} onClick={event => {
      event.preventDefault(); setFailed(false); void openExternalUrl(url).catch(() => setFailed(true));
    }}>{children}</a> : <span>{children}</span>;
  }
  function render(input: readonly Token[]): ReactNode {
    return input.map((token, index) => {
      // No extensions are enabled; unknown future tokens still fall back to literal raw text.
      const value = token as MarkedToken;
      let node: ReactNode;
      switch (value.type) {
        case 'space': case 'def': node = null; break;
        case 'heading': { const Tag = `h${value.depth}` as 'h1'|'h2'|'h3'|'h4'|'h5'|'h6'; node = <Tag>{render(value.tokens)}</Tag>; break; }
        case 'paragraph': node = <p>{render(value.tokens)}</p>; break;
        case 'text': node = value.tokens ? render(value.tokens) : decodeHTML(value.text); break;
        case 'strong': node = <strong>{render(value.tokens)}</strong>; break;
        case 'em': node = <em>{render(value.tokens)}</em>; break;
        case 'del': node = <del>{render(value.tokens)}</del>; break;
        case 'codespan': node = <code>{value.text}</code>; break;
        case 'code': node = <pre><code>{value.text}</code></pre>; break;
        case 'html': node = value.block ? <pre className="literal-html">{value.text}</pre> : <span>{value.text}</span>; break;
        case 'escape': node = value.text; break;
        case 'hr': node = <hr />; break;
        case 'br': node = <br />; break;
        case 'blockquote': node = <blockquote>{render(value.tokens)}</blockquote>; break;
        case 'link': node = link(value.autolink ? value.href : decodeHTML(value.href), render(value.tokens), value.title); break;
        case 'image': node = link(decodeHTML(value.href), t('markdownImage', { alt: inlineText(value.tokens) || value.text }), value.title); break;
        case 'checkbox': node = <input type="checkbox" checked={value.checked} disabled aria-label={t('markdownTask')} />; break;
        case 'list': { const items = value.items.map((item, i) => <li key={i}>{item.task && <input type="checkbox" checked={item.checked === true} disabled aria-label={t('markdownTask')} />}{render(item.tokens)}</li>);
          node = value.ordered ? <ol start={Number(value.start)}>{items}</ol> : <ul>{items}</ul>; break; }
        case 'list_item': node = <li>{render(value.tokens)}</li>; break;
        case 'table': { const cells = (row: Tokens.TableCell[], header: boolean) => row.map((cell, i) => header
          ? <th key={i} style={{ textAlign: cell.align ?? undefined }}>{render(cell.tokens)}</th>
          : <td key={i} style={{ textAlign: cell.align ?? undefined }}>{render(cell.tokens)}</td>);
          node = <div className="table-wrap"><table><thead><tr>{cells(value.header, true)}</tr></thead><tbody>{value.rows.map((row, i) => <tr key={i}>{cells(row, false)}</tr>)}</tbody></table></div>; break; }
        default: node = token.raw;
      }
      return <Fragment key={index}>{node}</Fragment>;
    });
  }
  return <div className="markdown">{render(tokens)}{failed && <p role="alert">{t('errors.externalOpenFailed')}</p>}</div>;
}
