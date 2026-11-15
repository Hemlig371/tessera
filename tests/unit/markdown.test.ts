import { expect, it } from 'vitest';
import { externalUrl, markdownPreview, splitInboxMarkdown } from '../../src/core/markdown';
it('extracts only a recognizable first heading and preserves unrecognized Markdown and literal line endings in the body', () => {
  expect(splitInboxMarkdown('# Тема **ёж** &amp; 🦔\r\n\r\n- один\r\n- два')).toEqual({ title: 'Тема ёж & 🦔', body: '\r\n- один\r\n- два' });
  for (const source of ['Вводная\n# Не первый заголовок\nТекст', 'Заголовок\n===\nТекст', '####### Не заголовок\nТекст', '    # Код\nТекст']) expect(splitInboxMarkdown(source).body).toBe(source);
  expect(splitInboxMarkdown('#\nТекст')).toEqual({ title: '', body: 'Текст' });
  expect(markdownPreview('- **Один**\n- Два [ссылка](https://example.org)')).toBe('Один Два ссылка');
});
it('only permits absolute web/mail links, including after normalization', () => {
  for (const url of ['javascript:alert(1)','JaVaScRiPt:alert(1)','data:text/html,test','file:///private','../file','//example.org']) expect(externalUrl(url)).toBeNull();
  expect(externalUrl('HTTPS://example.org/ёж')).toBe('https://example.org/%D1%91%D0%B6');
  expect(externalUrl('mailto:hello@example.org')).toBe('mailto:hello@example.org');
});
