// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  MAX_README_IMAGES,
  createReadmeRenderer,
  readmeImagePath,
} from '@/pages/settings/lib/readme.ts';

const render = createReadmeRenderer();

/** Живой DOM: проверяем, что получится в окне, а не текст разметки. */
const dom = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('createReadmeRenderer: враждебный README', () => {
  const hostile = [
    '# Hostile',
    '',
    '<script>window.__readmeScript = true</script>',
    '<img src="https://evil.example/pixel.png" onerror="window.__readmeOnerror = true">',
    '',
    '[click](javascript:window.__readmeLink=true)',
    '[data](data:text/html,<script>1</script>)',
    '[relative](../../secret)',
    '[mail](mailto:a@example.com)',
    '[http](http://example.com)',
    '[docs](https://example.com/docs)',
    '',
    '![external](https://evil.example/tracker.png)',
    '![inline](data:image/png;base64,iVBORw0KGgo=)',
    '![svg](docs/vector.svg)',
    '![up](../outside.png)',
    '![shot](docs/shot.png)',
  ].join('\n');

  it('сырой HTML выводится текстом: ни script, ни обработчиков событий', () => {
    const root = dom(render(hostile));
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelectorAll('img[onerror]')).toHaveLength(0);
    for (const element of root.querySelectorAll('*')) {
      expect(
        element.getAttributeNames().filter((name) => name.startsWith('on')),
      ).toEqual([]);
    }
    expect(root.textContent).toContain('<script>');
  });

  it('ссылкой остаётся только https: во внешний браузер, остальные — обычный текст', () => {
    const root = dom(render(hostile));
    const links = [...root.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/docs',
    ]);
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(root.textContent).toContain('relative');
    expect(root.textContent).toContain('mail');
    expect(root.textContent).toContain('http');
  });

  it('картинка — заглушка data-src без src; чужие и внешние заменены alt', () => {
    const root = dom(render(hostile));
    const images = [...root.querySelectorAll('img')];
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute('data-src')).toBe('docs/shot.png');
    expect(images[0]?.hasAttribute('src')).toBe(false);
    expect(images[0]?.getAttribute('alt')).toBe('shot');
    for (const alt of ['external', 'inline', 'svg', 'up']) {
      expect(root.textContent).toContain(alt);
    }
  });

  it('больше восьми картинок: девятая и далее — alt', () => {
    const source = Array.from(
      { length: MAX_README_IMAGES + 1 },
      (_, index) => `![pic${index}](img/${index}.png)`,
    ).join('\n\n');
    const root = dom(render(source));
    expect(root.querySelectorAll('img[data-src]')).toHaveLength(
      MAX_README_IMAGES,
    );
    expect(root.textContent).toContain(`pic${MAX_README_IMAGES}`);
    expect(root.querySelector(`img[data-src="img/${MAX_README_IMAGES}.png"]`))
      .toBeNull();
  });

  it('счётчик картинок не переходит между вызовами', () => {
    const one = '![a](a.png)';
    expect(dom(render(one)).querySelectorAll('img')).toHaveLength(1);
    expect(dom(render(one)).querySelectorAll('img')).toHaveLength(1);
  });

  it('alt с разметкой и кавычками не выходит из атрибута', () => {
    const root = dom(render('![a "quoted" <b>x</b>](a.png)'));
    const image = root.querySelector('img');
    expect(image?.getAttribute('alt')).toBe('a "quoted" <b>x</b>');
    expect(root.querySelector('b')).toBeNull();
  });

  it('ссылка, внутри которой картинка: не-https оставляет только картинку', () => {
    const root = dom(render('[![logo](logo.png)](javascript:alert(1))'));
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('img[data-src="logo.png"]')).not.toBeNull();
  });
});

describe('createReadmeRenderer: вёрстка', () => {
  it('заголовки сдвигаются под заголовки страницы и не глубже h6', () => {
    const html = render('# a\n\n## b\n\n###### f', { headingOffset: 3 });
    expect(html).toContain('<h4>a</h4>');
    expect(html).toContain('<h5>b</h5>');
    expect(html).toContain('<h6>f</h6>');
    expect(render('# a')).toContain('<h1>a</h1>');
  });

  it('блок кода и таблица получают фокус для прокрутки с клавиатуры', () => {
    const root = dom(render('```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'));
    expect(root.querySelector('pre')?.getAttribute('tabindex')).toBe('0');
    expect(root.querySelector('.readme-table')?.getAttribute('tabindex')).toBe(
      '0',
    );
    expect(root.querySelector('.readme-table table')).not.toBeNull();
  });
});

describe('readmeImagePath', () => {
  it.each([
    ['docs/shot.png', 'docs/shot.png'],
    ['./docs/shot.png', 'docs/shot.png'],
    ['docs/Shot.JPG', 'docs/Shot.JPG'],
    ['a.webp', 'a.webp'],
    ['a/b%20c.jpeg', 'a/b c.jpeg'],
  ])('%s → %s', (src, expected) => {
    expect(readmeImagePath(src)).toBe(expected);
  });

  it.each([
    '',
    'https://example.com/a.png',
    'data:image/png;base64,AAAA',
    '//example.com/a.png',
    '/etc/a.png',
    '../a.png',
    'a/../../b.png',
    'a\\b.png',
    'a.png?x=1',
    'a.png#f',
    'a.svg',
    'a.gif',
    'noextension',
    'a%00.png',
    'a%zz.png',
  ])('%j не картинка версии', (src) => {
    expect(readmeImagePath(src)).toBeNull();
  });
});
