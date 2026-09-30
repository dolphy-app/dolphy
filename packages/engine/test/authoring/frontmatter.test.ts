import { describe, expect, it } from 'vitest';
import {
  FrontYamlError,
  parseFrontmatterYaml,
} from '../../src/authoring/front-yaml.ts';
import {
  splitFrontmatter,
  stripFrontmatter,
} from '../../src/authoring/frontmatter.ts';

describe('splitFrontmatter / stripFrontmatter (T-35)', () => {
  it('срезает обычный блок', () => {
    expect(stripFrontmatter('---\nengine:\n  tags: [a]\n---\nBody\n')).toBe(
      'Body\n',
    );
  });

  it('понимает CRLF и BOM', () => {
    const split = splitFrontmatter(
      '\ufeff---\r\nengine:\r\n  tags: [a]\r\n---\r\nBody\r\n',
    );
    expect(split.front).toBe('engine:\r\n  tags: [a]\r\n');
    expect(split.body).toBe('Body\r\n');
    expect(split.frontStartLine).toBe(2);
  });

  it('закрывающий `...` и хвостовые пробелы на заборах', () => {
    expect(stripFrontmatter('---  \nengine: {}\n...\nx')).toBe('x');
    expect(stripFrontmatter('---\t\na: 1\n---   \nx')).toBe('x');
  });

  it('открывающий забор должен быть первой строкой и ровно `---`', () => {
    for (const text of [
      '\n---\na: 1\n---\nx',
      '----\na: 1\n---\nx',
      '--- a\nb: 1\n---\nx',
    ]) {
      expect(splitFrontmatter(text).front).toBeNull();
      expect(stripFrontmatter(text)).toBe(text);
    }
  });

  it('`---` + проза + `---` — thematic break, а не frontmatter', () => {
    const text = '---\nJust a rule\n---\nText\n';
    expect(stripFrontmatter(text)).toBe(text);
    expect(splitFrontmatter(text).unterminated).toBe(false);
  });

  it('блок не в начале файла не срезается и не разбирается', () => {
    const text = 'Intro\n\n---\nengine:\n  x: 1\n---\nMore\n';
    expect(splitFrontmatter(text).front).toBeNull();
    expect(stripFrontmatter(text)).toBe(text);
  });

  it('открытый и не закрытый блок с `key:` — unterminated, ничего не срезано', () => {
    const text = '---\nengine:\n  tags: [a]\nText';
    const split = splitFrontmatter(text);
    expect(split.unterminated).toBe(true);
    expect(split.front).toBeNull();
    expect(split.body).toBe(text);
    expect(stripFrontmatter(text)).toBe(text);
  });

  it('одинокий `---` и открытый блок без ключей — не ошибка', () => {
    expect(splitFrontmatter('---\nplain text only').unterminated).toBe(false);
    expect(stripFrontmatter('---')).toBe('---');
    expect(splitFrontmatter('---\n# comment\nprose').unterminated).toBe(false);
  });

  it('пустой блок — frontmatter', () => {
    const split = splitFrontmatter('---\n---\nBody');
    expect(split.front).toBe('');
    expect(split.body).toBe('Body');
    expect(stripFrontmatter('---\n\n# only a comment\n---\nBody')).toBe('Body');
  });

  it('срезается только первый блок', () => {
    expect(stripFrontmatter('---\na: 1\n---\nBody\n---\nb: 2\n---\n')).toBe(
      'Body\n---\nb: 2\n---\n',
    );
  });

  it('файл из одного frontmatter даёт пустое тело', () => {
    expect(stripFrontmatter('---\na: 1\n---')).toBe('');
    expect(stripFrontmatter('---\na: 1\n---\n')).toBe('');
  });

  it('ключ в кавычках открывает блок', () => {
    expect(stripFrontmatter('---\n"engine": {}\n---\nx')).toBe('x');
  });
});

describe('parseFrontmatterYaml (T-35)', () => {
  it('разбирает блок engine платформы', async () => {
    const doc = await parseFrontmatterYaml(
      [
        'engine:',
        '  exercise:',
        '    type: lms.sql',
        '    timeoutMs: 2000',
        '    spec:',
        '      fixture: "fixtures/a: b.sql"',
        '      orderSensitive: false',
        "  keyPrerequisites: [a::b, 'c d']",
        '  tags:',
        '    - x',
        '    - y',
        '  bloom: apply',
        '  dok: 2',
      ].join('\n'),
    );
    expect(doc).toEqual({
      engine: {
        exercise: {
          type: 'lms.sql',
          timeoutMs: 2000,
          spec: { fixture: 'fixtures/a: b.sql', orderSensitive: false },
        },
        keyPrerequisites: ['a::b', 'c d'],
        tags: ['x', 'y'],
        bloom: 'apply',
        dok: 2,
      },
    });
  });

  it('схема core YAML 1.2: `no` — строка, `010` — 10, `yes` — строка', async () => {
    expect(await parseFrontmatterYaml('a: no\nb: 010\nc: yes\nd: ~\n')).toEqual(
      {
        a: 'no',
        b: 10,
        c: 'yes',
        d: null,
      },
    );
  });

  it('двоеточие в кавычках, URL, unicode, CRLF', async () => {
    expect(
      await parseFrontmatterYaml(
        'k: "a: b"\r\nurl: http://example.com:80/x\r\nключ: значение Ω\r\nt: 12:30\r\n',
      ),
    ).toEqual({
      k: 'a: b',
      url: 'http://example.com:80/x',
      ключ: 'значение Ω',
      t: '12:30',
    });
  });

  it('комментарии игнорируются', async () => {
    expect(
      await parseFrontmatterYaml("k: v # comment\n# full\nk2: 'a # b'\n"),
    ).toEqual({ k: 'v', k2: 'a # b' });
  });

  it('пустой текст даёт null', async () => {
    expect(await parseFrontmatterYaml('')).toBeNull();
  });

  it('псевдонимы отвергаются политикой maxAliasCount: 0', async () => {
    await expect(parseFrontmatterYaml('a: &x 1\nb: *x\n')).rejects.toThrow(
      FrontYamlError,
    );
  });

  it.each([
    ['двоеточие в простом скаляре', 'a: b: c\n', 1],
    ['табы в отступе', 'a:\n\tb: 1\n', 2],
    ['дубликат ключа', 'a: 1\na: 2\n', 2],
    ['незакрытая последовательность', 'a: 1\nb: [x', 2],
  ])('отвергает: %s — с номером строки', async (_name, text, line) => {
    const error: unknown = await parseFrontmatterYaml(text).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(FrontYamlError);
    expect((error as FrontYamlError).line).toBe(line);
  });
});
