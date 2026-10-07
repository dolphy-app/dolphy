import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../src/bundle.ts';
import { watchExtension } from '../src/index.ts';
import type { BuildLogger } from '../src/index.ts';
import { createReporter } from '../src/watch.ts';
import type { RebuildReport } from '../src/watch.ts';
import { copyProject } from './helpers.ts';

/**
 * Logger that records both streams; `until` resolves on the line that makes
 * its condition true. A test waits for what the build reports, not for a delay
 * or for files that a rebuild rewrites.
 */
const recordLogger = () => {
  const info: string[] = [];
  const error: string[] = [];
  const waiting: (() => void)[] = [];
  const record = (lines: string[], message: string): void => {
    lines.push(message);
    for (const check of waiting.splice(0)) check();
  };
  const logger: BuildLogger = {
    info: (message) => void record(info, message),
    error: (message) => void record(error, message),
  };
  const until = (isDone: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (isDone()) resolve();
        else waiting.push(check);
      };
      check();
    });
  return { logger, info, error, until };
};

/** Files named by the `rebuilt …` lines: one rebuild cycle may be reported in several lines. */
const rebuiltFiles = (info: readonly string[]): Set<string> =>
  new Set(
    info.flatMap((line) => {
      const match = /^rebuilt (.+)$/.exec(line);
      return match === null ? [] : (match[1] as string).split(', ');
    }),
  );

const edit = async (
  file: string,
  change: (text: string) => string,
): Promise<void> => {
  await writeFile(file, change(await readFile(file, 'utf8')));
};

/** Replaces the file in one step, as editors do: the watcher never sees it truncated. */
const replace = async (file: string, text: string): Promise<void> => {
  const next = `${file}.next`;
  await writeFile(next, text);
  await rename(next, file);
};

const read = (dir: string, file: string): Promise<string> =>
  readFile(path.join(dir, file), 'utf8');

describe('watchExtension', () => {
  it('R8 inline maps point back at the lines of src/index.ts after pruning and import stripping', async () => {
    const root = await copyProject('surfaces');
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    try {
      const source = (
        await readFile(path.join(root, 'src', 'index.ts'), 'utf8')
      ).split('\n');
      const markers = [
        'SERVER_ONLY_MARKER',
        'VIEW_ONE_MARKER',
        'VIEW_TWO_MARKER',
        'PANEL_FIRST_MARKER',
        'INJECTION_CARD_MARKER',
        'ALPHA_MARKER',
      ];
      const found = new Set<string>();
      for (const file of handle.result.files.filter((name) =>
        name.endsWith('.mjs'),
      )) {
        const code = await read(handle.result.dir, file);
        const comment =
          /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,(\S+)/.exec(
            code,
          );
        const trace = new TraceMap(
          Buffer.from(comment?.[1] ?? '', 'base64').toString('utf8'),
        );
        const lines = code.split('\n');
        for (const marker of markers) {
          const index = lines.findIndex((line) => line.includes(marker));
          if (index < 0) continue;
          const original = originalPositionFor(trace, {
            line: index + 1,
            column: (lines[index] as string).indexOf(marker),
          });
          expect(original.source, `${file} ${marker}`).toMatch(
            /src\/index\.ts$/,
          );
          expect(
            source[(original.line ?? 0) - 1],
            `${file} ${marker}`,
          ).toContain(marker);
          found.add(marker);
        }
      }
      expect([...found].sort()).toEqual([...markers].sort());
    } finally {
      await handle.close();
    }
  });

  it('R8 every bundle of the watch output carries an inline source map to the sources', async () => {
    const MAP =
      /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,(\S+)/;
    for (const name of ['hello', 'commands-panel', 'with-worker']) {
      const root = await copyProject(name);
      const handle = await watchExtension({
        root,
        outDir: path.join(root, 'out'),
      });
      try {
        const scripts = handle.result.files.filter((file) =>
          file.endsWith('.mjs'),
        );
        expect(scripts.length).toBeGreaterThan(0);
        for (const file of scripts) {
          const match = MAP.exec(await read(handle.result.dir, file));
          expect(match, `${name}/${file} has an inline map`).not.toBeNull();
          const map = JSON.parse(
            Buffer.from(match?.[1] ?? '', 'base64').toString('utf8'),
          ) as { sources: string[]; mappings: string };
          expect(map.mappings.length).toBeGreaterThan(0);
          expect(map.sources.some((source) => source.endsWith('.ts'))).toBe(
            true,
          );
        }
      } finally {
        await handle.close();
      }
    }
  });

  it('T-20 editing src/index.ts rebuilds affected files and reports them in the log', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      const { dir } = handle.result;
      expect(handle.result.files).toEqual([
        'client.mjs',
        'extension.json',
        'main.mjs',
      ]);
      expect(await read(dir, 'main.mjs')).not.toContain('watch-host');
      const index = path.join(root, 'src', 'index.ts');
      await edit(index, (text) =>
        text
          .replace('project: () => ({})', "project: () => 'watch-host'")
          .replace("h('input')", "h('input', { title: 'watch-view' })"),
      );
      await log.until(() => rebuiltFiles(log.info).size === 2);
      expect(rebuiltFiles(log.info)).toEqual(
        new Set(['main.mjs', 'client.mjs']),
      );
      expect(await read(dir, 'main.mjs')).toContain('watch-host');
      expect(await read(dir, 'client.mjs')).toContain('watch-view');
      expect(log.error).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it('an error in src/index.ts names the files and is logged once; a fix rebuilds', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      const index = path.join(root, 'src', 'index.ts');
      const good = await readFile(index, 'utf8');
      await writeFile(
        index,
        `import { readFileSync } from 'node:fs';\n${good.replace(
          "c.addAnswerView('acme.hello', input);",
          "c.addAnswerView('acme.hello', input);\n  readFileSync('/x');",
        )}`,
      );
      await log.until(() => log.error.length > 0);
      expect(log.error).toHaveLength(1);
      expect(log.error[0]).toContain('acme.hello');
      expect(log.error[0]).toContain('client.mjs (client from src/index.ts)');
      expect(log.error[0]).toContain("client.mjs imports 'node:fs'");
      expect(log.error[0]).not.toContain('main.mjs');

      await writeFile(
        index,
        good.replace("h('input')", "h('input', { title: 'fixed' })"),
      );
      await log.until(() => rebuiltFiles(log.info).has('client.mjs'));
      expect(await read(handle.result.dir, 'client.mjs')).toContain('fixed');
      expect(log.error).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it('editing extension.json rebuilds the manifest of the output and reports the files', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      const { dir } = handle.result;
      const manifestFile = path.join(root, 'extension.json');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
        description?: string;
      };
      manifest.description = 'Edited while watching';
      await replace(manifestFile, JSON.stringify(manifest));
      await log.until(() => rebuiltFiles(log.info).has('extension.json'));
      expect(rebuiltFiles(log.info)).toEqual(
        new Set(['client.mjs', 'extension.json', 'main.mjs']),
      );
      const built = JSON.parse(await read(dir, 'extension.json')) as {
        description: string;
        main: string | null;
        client: string | null;
      };
      expect(built.description).toBe('Edited while watching');
      expect(built.main).toBe('./main.mjs');
      expect(built.client).toBe('./client.mjs');
      expect((await read(dir, 'main.mjs')).length).toBeGreaterThan(0);
      expect(log.error).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it('an invalid extension.json is logged and the previous output stays until it is fixed', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      const { dir } = handle.result;
      const manifestFile = path.join(root, 'extension.json');
      const good = await readFile(manifestFile, 'utf8');
      await replace(manifestFile, good.replace('acme.hello', 'Bad Id'));
      await log.until(() =>
        log.error.some((message) => message.includes('invalid extension id')),
      );
      expect((await read(dir, 'main.mjs')).length).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});

describe('createReporter', () => {
  const QUIET_MS = 150;

  const job = (output: string): Job => ({
    output,
    label: `${output} (from src/index.ts)`,
    config: {},
    state: { problem: null },
  });

  const open = () => {
    const reports: RebuildReport[] = [];
    const reporter = createReporter((report) => {
      reports.push(report);
    }, QUIET_MS);
    return { reporter, reports };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the bundles of one cycle make one report, and the next cycle a separate one', () => {
    vi.useFakeTimers();
    const { reporter, reports } = open();
    reporter.begin();
    reporter.begin();
    reporter.rebuilt(job('main.mjs'));
    reporter.end();
    vi.advanceTimersByTime(QUIET_MS - 50);
    reporter.rebuilt(job('client.mjs'));
    reporter.end();
    vi.advanceTimersByTime(QUIET_MS - 1);
    expect(reports).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reports).toEqual([
      { rebuilt: ['main.mjs', 'client.mjs'], failures: [] },
    ]);

    reporter.begin();
    reporter.rebuilt(job('main.mjs'));
    reporter.end();
    vi.advanceTimersByTime(QUIET_MS);
    expect(reports).toHaveLength(2);
    expect(reports[1]).toEqual({ rebuilt: ['main.mjs'], failures: [] });
    reporter.close();
  });

  it('a bundle that is still rebuilding holds the report back, however long it takes', () => {
    vi.useFakeTimers();
    const { reporter, reports } = open();
    reporter.begin();
    reporter.begin();
    reporter.rebuilt(job('main.mjs'));
    reporter.end();
    vi.advanceTimersByTime(60 * QUIET_MS);
    expect(reports).toEqual([]);
    reporter.rebuilt(job('client.mjs'));
    reporter.end();
    vi.advanceTimersByTime(QUIET_MS);
    expect(reports).toEqual([
      { rebuilt: ['main.mjs', 'client.mjs'], failures: [] },
    ]);
    reporter.close();
  });

  it('identical causes are one failure naming every bundle; different causes stay apart', () => {
    vi.useFakeTimers();
    const { reporter, reports } = open();
    reporter.failed(job('main.mjs'), 'no export');
    reporter.failed(job('client.mjs'), 'no export');
    reporter.failed(job('main.mjs'), 'no export');
    reporter.failed(job('worker.mjs'), 'bad import');
    vi.advanceTimersByTime(QUIET_MS);
    expect(reports).toEqual([
      {
        rebuilt: [],
        failures: [
          {
            labels: [
              'main.mjs (from src/index.ts)',
              'client.mjs (from src/index.ts)',
            ],
            detail: 'no export',
          },
          { labels: ['worker.mjs (from src/index.ts)'], detail: 'bad import' },
        ],
      },
    ]);
    reporter.close();
  });

  it('a cycle that rebuilt and failed nothing is not reported', () => {
    vi.useFakeTimers();
    const { reporter, reports } = open();
    reporter.begin();
    reporter.end();
    vi.advanceTimersByTime(10 * QUIET_MS);
    expect(reports).toEqual([]);
    reporter.close();
  });
});
