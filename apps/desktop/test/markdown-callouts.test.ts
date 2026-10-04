import { describe, expect, it } from 'vitest';
import {
  CALLOUT_KINDS,
  createMarkdownRenderer,
} from '@/shared/lib/markdown.ts';

const render = createMarkdownRenderer(new Set());

describe('Markdown callouts', () => {
  it.each(CALLOUT_KINDS)('`> [!%s]` makes a callout of that kind', (kind) => {
    const html = render(`> [!${kind.toUpperCase()}]\n> Текст врезки`);
    expect(html).toContain(`<blockquote class="callout callout--${kind}">`);
    expect(html).toContain('Текст врезки');
    expect(html).not.toContain('[!');
  });

  it('is case-insensitive', () => {
    expect(render('> [!warning]\n> a')).toContain('callout--warning');
  });

  it('keeps the text of the first line after the marker', () => {
    const html = render('> [!TIP] Совет на той же строке\n> и продолжение');
    expect(html).toContain('Совет на той же строке');
    expect(html).not.toContain('[!');
  });

  it('drops the empty paragraph when the marker stands alone', () => {
    const html = render('> [!WARNING]\n>\n> - первый\n> - второй');
    expect(html).toContain('callout--warning');
    expect(html).not.toContain('<p></p>');
    expect(html).toContain('<li>первый</li>');
    // маркер был единственным в абзаце: первым в врезке идёт список
    expect(html).toMatch(/<blockquote[^>]*>\s*<ul>/);
  });

  it('keeps highlighted code blocks inside a callout', () => {
    const html = render('> [!NOTE]\n>\n> ```js\n> const a = 1;\n> ```');
    expect(html).toContain('callout--note');
    expect(html).toContain('sh__token--keyword');
  });

  it.each([
    ['a plain quote', '> Просто цитата'],
    ['an unknown kind', '> [!DANGER]\n> текст'],
    ['a marker that is not first', '> текст\n> [!NOTE]'],
    ['a marker outside a quote', '[!NOTE] не в цитате'],
  ])('leaves %s untouched', (_name, source) => {
    expect(render(source)).not.toContain('callout');
  });

  it('turns only the first paragraph of the quote into the marker', () => {
    const html = render('> Первый\n>\n> [!NOTE]\n> второй');
    expect(html).not.toContain('callout');
    expect(html).toContain('[!NOTE]');
  });
});
