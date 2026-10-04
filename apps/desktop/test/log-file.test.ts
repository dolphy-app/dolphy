import { describe, expect, it, vi } from 'vitest';
import {
  MAX_LINE_CHARS,
  createLogFile,
  createProcessOutput,
} from '../electron/main/log-file.ts';
import type { LogFileSystem } from '../electron/main/log-file.ts';

const DAY = 24 * 60 * 60 * 1000;
const DIR = '/logs';

/** Местное время: журнал делит файлы по календарному дню пользователя. */
const at = (day: number, hour = 12): number =>
  new Date(2026, 9, day, hour, 0, 0).getTime();

const setup = (
  options: {
    start?: number;
    maxFileBytes?: number;
    maxTotalBytes?: number;
    seed?: Record<string, { size?: number; ageMs?: number; text?: string }>;
    failAppend?: () => boolean;
  } = {},
) => {
  const state = { now: options.start ?? at(4) };
  const files = new Map<
    string,
    { text: string; size: number; mtimeMs: number }
  >();
  for (const [name, seed] of Object.entries(options.seed ?? {})) {
    const text = seed.text ?? '';
    files.set(`${DIR}/${name}`, {
      text,
      size: seed.size ?? text.length,
      mtimeMs: state.now - (seed.ageMs ?? 0),
    });
  }
  const created: string[] = [];
  const fs: LogFileSystem = {
    mkdir: () => undefined,
    list: () => [...files.keys()].map((path) => path.slice(DIR.length + 1)),
    stat: (path) => {
      const file = files.get(path);
      if (file === undefined) throw new Error('ENOENT');
      return { size: file.size, mtimeMs: file.mtimeMs };
    },
    append: (path, text) => {
      if (options.failAppend?.()) throw new Error('ENOSPC');
      const file = files.get(path);
      if (file === undefined) created.push(path);
      files.set(path, {
        text: (file?.text ?? '') + text,
        size: (file?.size ?? 0) + Buffer.byteLength(text),
        mtimeMs: state.now,
      });
    },
    remove: (path) => void files.delete(path),
  };
  const errors: unknown[] = [];
  const open = () =>
    createLogFile({
      dir: DIR,
      clock: { now: () => state.now },
      fs,
      ...(options.maxFileBytes !== undefined && {
        maxFileBytes: options.maxFileBytes,
      }),
      ...(options.maxTotalBytes !== undefined && {
        maxTotalBytes: options.maxTotalBytes,
      }),
      onError: (error) => errors.push(error),
    });
  const names = () =>
    [...files.keys()].map((path) => path.slice(DIR.length + 1)).sort();
  const linesOf = (name: string): Record<string, unknown>[] =>
    (files.get(`${DIR}/${name}`)?.text ?? '')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { state, files, open, names, linesOf, errors, created };
};

describe('файловый журнал', () => {
  it('пишет JSON-строки level/source/message/at/поля; логгеры движка и хоста приводятся к той же форме', () => {
    const h = setup();
    const log = h.open();

    log.write('main', {
      level: 'info',
      source: 'main',
      message: 'extension host ready',
      pid: 7,
      at: 111,
    });
    log.writeLine(
      'engine',
      JSON.stringify({
        level: 'warn',
        time: 222,
        msg: 'slow',
        extensionId: 'a.b',
      }),
    );
    log.writeLine('ext-host', 'plain crash text');

    expect(h.names()).toEqual(['dolphy-2026-10-04.log']);
    expect(h.linesOf('dolphy-2026-10-04.log')).toEqual([
      {
        level: 'info',
        source: 'main',
        message: 'extension host ready',
        at: 111,
        pid: 7,
      },
      {
        level: 'warn',
        source: 'engine',
        message: 'slow',
        at: 222,
        extensionId: 'a.b',
      },
      {
        level: 'warn',
        source: 'ext-host',
        message: 'plain crash text',
        at: at(4),
      },
    ]);
  });

  it('запись движка с полем message в данных: сообщением остаётся msg', () => {
    const h = setup();
    const log = h.open();
    log.writeLine(
      'engine',
      JSON.stringify({
        level: 'info',
        time: 5,
        msg: 'ready',
        message: { type: 'ready' },
      }),
    );
    expect(h.linesOf('dolphy-2026-10-04.log')[0]).toMatchObject({
      message: 'ready',
      at: 5,
    });
  });

  it('источник задаёт писатель, а не процесс; неизвестный уровень — info; Error сериализуется', () => {
    const h = setup();
    const log = h.open();

    log.writeLine(
      'ext-host',
      JSON.stringify({ level: 'loud', source: 'main', message: 'm', at: 1 }),
    );
    log.write('main', {
      level: 'error',
      message: 'm',
      error: new Error('boom'),
    });

    const [first, second] = h.linesOf('dolphy-2026-10-04.log');
    expect(first).toMatchObject({ level: 'info', source: 'ext-host' });
    expect(second).toMatchObject({
      level: 'error',
      error: { name: 'Error', message: 'boom' },
    });
  });

  it('новый файл каждый день', () => {
    const h = setup({ start: at(4, 23) });
    const log = h.open();
    log.write('main', { level: 'info', message: 'late' });
    h.state.now = at(5, 0) + 60_000;
    log.write('main', { level: 'info', message: 'early' });

    expect(h.names()).toEqual([
      'dolphy-2026-10-04.log',
      'dolphy-2026-10-05.log',
    ]);
    expect(h.linesOf('dolphy-2026-10-05.log')).toHaveLength(1);
  });

  it('новый файл по достижении предела размера: .1, .2; записи не теряются и не дробятся', () => {
    const h = setup({ maxFileBytes: 200 });
    const log = h.open();
    for (let index = 0; index < 6; index += 1) {
      log.write('main', {
        level: 'info',
        message: `m${index}`,
        pad: 'x'.repeat(10),
      });
    }

    expect(h.names()).toEqual([
      'dolphy-2026-10-04.1.log',
      'dolphy-2026-10-04.2.log',
      'dolphy-2026-10-04.log',
    ]);
    const all = h
      .names()
      .flatMap((name) => h.linesOf(name))
      .map((line) => line.message)
      .sort();
    expect(all).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
    for (const name of h.names()) {
      expect(h.files.get(`${DIR}/${name}`)?.size).toBeLessThanOrEqual(200);
    }
  });

  it('после перезапуска продолжает сегодняшний файл, пока он не полон, затем берёт следующий номер', () => {
    const h = setup({
      maxFileBytes: 300,
      seed: {
        'dolphy-2026-10-04.log': { size: 100, text: '{}\n' },
        'dolphy-2026-10-04.1.log': { size: 100, text: '{}\n' },
      },
    });
    const log = h.open();
    log.write('main', { level: 'info', message: 'one' });
    expect(h.names()).toEqual([
      'dolphy-2026-10-04.1.log',
      'dolphy-2026-10-04.log',
    ]);
    expect(h.linesOf('dolphy-2026-10-04.1.log').at(-1)).toMatchObject({
      message: 'one',
    });

    log.write('main', { level: 'info', message: 'two', pad: 'x'.repeat(150) });
    expect(h.names()).toContain('dolphy-2026-10-04.2.log');
  });

  describe('удаление старого', () => {
    it('при запуске: старше 7 суток удаляются, свежие остаются, чужие файлы не трогаются', () => {
      const h = setup({
        seed: {
          'dolphy-2026-09-20.log': { size: 10, ageMs: 14 * DAY },
          'dolphy-2026-09-26.log': { size: 10, ageMs: 7 * DAY + 1 },
          'dolphy-2026-09-29.log': { size: 10, ageMs: 7 * DAY - 1000 },
          'dolphy-2026-10-03.log': { size: 10, ageMs: DAY },
          'other.log': { size: 10, ageMs: 100 * DAY },
        },
      });
      h.open();
      expect(h.names()).toEqual([
        'dolphy-2026-09-29.log',
        'dolphy-2026-10-03.log',
        'other.log',
      ]);
    });

    it('при запуске: самые старые уходят, пока сумма больше предела; текущий файл не удаляется', () => {
      const h = setup({
        maxTotalBytes: 1000,
        maxFileBytes: 5000,
        seed: {
          'dolphy-2026-10-01.log': { size: 400, ageMs: 3 * DAY },
          'dolphy-2026-10-02.log': { size: 400, ageMs: 2 * DAY },
          'dolphy-2026-10-03.log': { size: 400, ageMs: DAY },
          'dolphy-2026-10-04.log': { size: 900, ageMs: 1000 },
        },
      });
      h.open();
      expect(h.names()).toEqual(['dolphy-2026-10-04.log']);
    });

    it('текущий файл сам по себе больше предела суммы остаётся', () => {
      const h = setup({
        maxTotalBytes: 100,
        maxFileBytes: 5000,
        seed: { 'dolphy-2026-10-04.log': { size: 900, ageMs: 1000 } },
      });
      h.open();
      expect(h.names()).toEqual(['dolphy-2026-10-04.log']);
    });

    it('при смене файла (новый день, предел размера) уборка повторяется', () => {
      const h = setup({ maxTotalBytes: 500, maxFileBytes: 300 });
      const log = h.open();
      h.files.set(`${DIR}/dolphy-2026-09-30.log`, {
        text: '',
        size: 450,
        mtimeMs: h.state.now - DAY,
      });
      h.files.set(`${DIR}/dolphy-2026-09-01.log`, {
        text: '',
        size: 5,
        mtimeMs: h.state.now - 30 * DAY,
      });
      log.write('main', { level: 'info', message: 'first' });
      // файл дня создан, но смены файла не было: прежние остаются
      expect(h.names()).toContain('dolphy-2026-09-30.log');

      h.state.now = at(5);
      log.write('main', { level: 'info', message: 'next day' });
      expect(h.names()).toEqual([
        'dolphy-2026-10-04.log',
        'dolphy-2026-10-05.log',
      ]);
    });
  });

  it('сбой записи не бросает исключения; об отказе сообщается один раз за серию, после успеха — снова', () => {
    let failing = true;
    const h = setup({ failAppend: () => failing });
    const log = h.open();

    expect(() => {
      log.write('main', { level: 'info', message: 'a' });
      log.write('main', { level: 'info', message: 'b' });
    }).not.toThrow();
    expect(h.errors).toHaveLength(1);

    failing = false;
    log.write('main', { level: 'info', message: 'c' });
    failing = true;
    log.write('main', { level: 'info', message: 'd' });
    expect(h.errors).toHaveLength(2);
  });

  it('гигантская строка усекается, ротация не ломается', () => {
    const h = setup();
    const log = h.open();
    log.writeLine('engine', 'x'.repeat(MAX_LINE_CHARS * 2));

    const [entry] = h.linesOf('dolphy-2026-10-04.log');
    expect(entry).toMatchObject({ level: 'warn', source: 'engine' });
    expect(String(entry?.message).length).toBeLessThan(3000);
    expect(entry?.truncatedChars).toBeGreaterThan(MAX_LINE_CHARS);
  });
});

describe('вывод дочернего процесса', () => {
  const setupOutput = () => {
    const lines: [string, string][] = [];
    const mirrored = { stdout: [] as string[], stderr: [] as string[] };
    const output = createProcessOutput({
      source: 'engine',
      file: {
        write: vi.fn(),
        writeLine: (source, line) => lines.push([source, line]),
      },
      mirror: {
        stdout: { write: (chunk) => mirrored.stdout.push(String(chunk)) },
        stderr: { write: (chunk) => mirrored.stderr.push(String(chunk)) },
      },
    });
    return { output, lines, mirrored };
  };

  it('stderr повторяется как есть и пишется в журнал построчно, строка может прийти кусками', () => {
    const { output, lines, mirrored } = setupOutput();
    output.stderr('{"a":1}\n{"b"');
    output.stderr(':2}\r\n\n');
    output.stderr('tail without newline');
    expect(lines).toEqual([
      ['engine', '{"a":1}'],
      ['engine', '{"b":2}'],
    ]);
    expect(mirrored.stderr.join('')).toBe(
      '{"a":1}\n{"b":2}\r\n\ntail without newline',
    );

    output.flush();
    expect(lines.at(-1)).toEqual(['engine', 'tail without newline']);
  });

  it('многобайтовый символ на границе кусков не портится; stdout только повторяется', () => {
    const { output, lines, mirrored } = setupOutput();
    const bytes = new TextEncoder().encode('привет\n');
    output.stderr(bytes.slice(0, 3));
    output.stderr(bytes.slice(3));
    output.stdout('to terminal');
    expect(lines).toEqual([['engine', 'привет']]);
    expect(mirrored.stdout).toEqual(['to terminal']);
  });
});
