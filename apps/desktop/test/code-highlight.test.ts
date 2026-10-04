import { describe, expect, it } from 'vitest';
import { MAX_HIGHLIGHT_CHARS, highlightCode } from '@/shared/lib/highlight.ts';
import { createMarkdownRenderer } from '@/shared/lib/markdown.ts';

const render = createMarkdownRenderer(new Set(['math']));

describe('highlightCode', () => {
  it('wraps only the tokens that have their own color', () => {
    const html = highlightCode("const n = 42; // готово\nlog('a b');", 'js');
    expect(html).toContain('<span class="sh__token--keyword">const</span>');
    expect(html).toContain('<span class="sh__token--class">42</span>');
    expect(html).toContain('<span class="sh__token--comment">// готово</span>');
    // имена, знаки и пробелы читаются цветом блока: отдельные <span> им не нужны
    expect(html).not.toMatch(/sh__token--(space|identifier|sign)/);
    // цвет задаёт CSS класса, а не inline-стиль токена
    expect(html).not.toContain('style=');
  });

  it('keeps every line of the block', () => {
    const html = highlightCode('a;\nb;\nc;', 'js') ?? '';
    expect(html.match(/class="sh__line"/g)).toHaveLength(3);
  });

  it('resolves fence aliases to canonical languages', () => {
    for (const alias of [
      'js',
      'javascript',
      'ts',
      'bash',
      'sh',
      'py',
      'html',
    ]) {
      expect(highlightCode('x', alias), alias).not.toBeNull();
    }
  });

  it('escapes markup in code instead of passing it through', () => {
    const html =
      highlightCode('const x = "<img src=x onerror=alert(1)>";', 'js') ?? '';
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it.each(['', 'text', 'plaintext', 'brainfuck', 'math'])(
    'does not highlight language %j',
    (language) => {
      expect(highlightCode('const x = 1;', language)).toBeNull();
    },
  );

  it('skips code longer than the limit', () => {
    expect(highlightCode('x;'.repeat(MAX_HIGHLIGHT_CHARS), 'js')).toBeNull();
    expect(highlightCode('x;'.repeat(100), 'js')).not.toBeNull();
  });
});

describe('Markdown code blocks', () => {
  it('highlights a fenced block with a known language and keeps it focusable', () => {
    const html = render('```js\nconst a = 1;\n```');
    expect(html).toContain('<pre tabindex="0">');
    expect(html).toContain('class="language-js"');
    expect(html).toContain('sh__token--keyword');
  });

  it('leaves a block without a language as plain escaped code', () => {
    const html = render('```\nconst a = "<b>";\n```');
    expect(html).not.toContain('sh__token');
    expect(html).toContain('&lt;b&gt;');
  });

  it('leaves indented code and inline code as plain code', () => {
    expect(render('    const a = 1;')).not.toContain('sh__token');
    expect(render('a `const b` c')).not.toContain('sh__token');
  });

  it('does not highlight a block that an extension renderer takes over', () => {
    const html = render('```math\nx^2\n```');
    expect(html).toContain('data-state="pending"');
    expect(html).not.toContain('sh__token');
  });
});
