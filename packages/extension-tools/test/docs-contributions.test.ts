/**
 * Примеры из разделов «Точки вклада», «Права и изоляция» и «Установка и каталог»
 * `docs/design/extensions.md` проверяются машиной: документ не расходится с кодом.
 *
 * Соглашение о маркерах: пример — обычный блок кода, последняя непустая строка
 * перед открывающей оградой имеет вид ``Файл `<путь>` (<метка>):``. Блоки без такой
 * строки (фрагменты) не проверяются. Метка объединяет файлы одного примера;
 * каждая метка обязана быть в `EXAMPLES` с режимом проверки, а каждая запись
 * `EXAMPLES` — встретиться в документе.
 *
 * - `manifest` — `extension.json` проходит `parseManifest`;
 * - `build-no-code` — проект из одного `extension.json` собирается и проходит
 *   `validateExtension`;
 * - `build-with-code` — проект из `extension.json` и одного `src/index.ts` (блок ```ts
 *   с маркером) собирается, проходит `validateExtension` и `tsc` с типами id,
 *   которые сборка записала в `.dolphy/ids.d.ts`;
 * - `index` — единственный файл `index.json` проходит `parseIndex`
 *   (`@dolphy-app/extension-catalog`).
 *
 * Пример «серия дней целиком» к тому же исполняется: собранный `main.mjs`
 * проходит через `loadEvents` и `loadCommands` из SDK.
 */
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex } from '@dolphy-app/extension-catalog';
import { parseManifest } from '@dolphy-app/extension-host';
import { describe, expect, it } from 'vitest';
import { buildExtension, validateExtension } from '../src/index.ts';
import { makeTemp, runTsc } from './helpers.ts';

type Mode = 'manifest' | 'build-no-code' | 'build-with-code' | 'index';

const EXAMPLES: Readonly<Record<string, Mode>> = {
  'вид задания': 'manifest',
  тема: 'build-no-code',
  'рендерер содержимого': 'build-with-code',
  'правило оценки': 'build-with-code',
  'настройки расширения': 'build-no-code',
  'подписка на события': 'build-with-code',
  'команды расширения': 'build-with-code',
  'панель расширения': 'build-with-code',
  'серия дней целиком': 'build-with-code',
  'вид задания с правами': 'manifest',
  'расширение для каталога': 'build-no-code',
  'индекс каталога': 'index',
};

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const DOC = path.join(REPO_ROOT, 'docs/design/extensions.md');
const SECTIONS = [
  '## Точки вклада',
  '## Права и изоляция',
  '## Установка и каталог',
  '## Как написать расширение',
];
const MARKER = /^Файл `([^`]+)` \(([^)]+)\):$/;

interface ExampleFile {
  file: string;
  lang: string;
  content: string;
}

const sectionOf = (doc: string, section: string): string[] => {
  const lines = doc.split('\n');
  const start = lines.indexOf(section);
  if (start === -1) throw new Error(`no '${section}' section`);
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  );
  return lines.slice(start + 1, end === -1 ? undefined : end);
};

const collect = (lines: string[]): Map<string, ExampleFile[]> => {
  const examples = new Map<string, ExampleFile[]>();
  let previous = '';
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\w+)$/.exec(lines[i] ?? '');
    const marker = MARKER.exec(previous);
    if ((lines[i] ?? '').trim() !== '') previous = lines[i] ?? '';
    if (marker === null || fence === null) continue;
    const close = lines.indexOf('```', i + 1);
    if (close === -1) throw new Error('unterminated code fence');
    const [, file, label] = marker as unknown as [string, string, string];
    const files = examples.get(label) ?? [];
    files.push({
      file,
      lang: fence[1] ?? '',
      content: `${lines.slice(i + 1, close).join('\n')}\n`,
    });
    examples.set(label, files);
  }
  return examples;
};

const doc = await readFile(DOC, 'utf8');
const examples = collect(
  SECTIONS.flatMap((section) => sectionOf(doc, section)),
);

const manifestOf = (files: ExampleFile[]): unknown => {
  const manifests = files.filter(({ file }) => file === 'extension.json');
  expect(manifests).toHaveLength(1);
  return JSON.parse(manifests[0]?.content ?? '');
};

/** Проект во временном каталоге; SDK и API — ссылки на пакеты репозитория. */
const writeProject = async (
  files: ExampleFile[],
  withCode: boolean,
): Promise<string> => {
  const root = path.join(await makeTemp(), 'project');
  await mkdir(root, { recursive: true });
  for (const { file, content } of files) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (withCode) {
    const modules = path.join(root, 'node_modules', '@dolphy-app');
    await mkdir(modules, { recursive: true });
    for (const name of ['extension-sdk', 'extension-api']) {
      await symlink(
        path.join(REPO_ROOT, 'packages', name),
        path.join(modules, name),
        'dir',
      );
    }
  }
  return root;
};

const TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    target: 'ES2023',
    lib: ['ES2023', 'DOM'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    types: [],
    strict: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src', '.dolphy/ids.d.ts'],
})}\n`;

describe('примеры разделов «Точки вклада», «Права и изоляция», «Установка и каталог» и «Как написать расширение»', () => {
  it('метки примеров совпадают с таблицей проверок', () => {
    expect([...examples.keys()].sort()).toEqual(Object.keys(EXAMPLES).sort());
  });

  for (const [label, mode] of Object.entries(EXAMPLES)) {
    describe(label, () => {
      if (mode === 'index') {
        it('index.json проходит parseIndex', () => {
          const files = examples.get(label) ?? [];
          expect(files.map(({ file }) => file)).toEqual(['index.json']);
          const index = parseIndex(JSON.parse(files[0]?.content ?? ''));
          expect(index.extensions.length).toBeGreaterThan(0);
        });
        return;
      }

      it('extension.json проходит parseManifest', () => {
        const result = parseManifest(manifestOf(examples.get(label) ?? []));
        expect(result).toMatchObject({ ok: true });
      });

      if (mode === 'manifest') return;

      it('проект собирается и проходит validate', async () => {
        const files = examples.get(label) ?? [];
        const withCode = mode === 'build-with-code';
        if (withCode) {
          expect(
            files.filter(({ lang }) => lang === 'ts').map(({ file }) => file),
          ).toEqual(['src/index.ts']);
        } else {
          expect(files.map(({ file }) => file)).toEqual(['extension.json']);
        }
        const root = await writeProject(files, withCode);
        const built = await buildExtension({ root });
        expect(built.files.some((file) => file.endsWith('.mjs'))).toBe(
          withCode,
        );
        await expect(validateExtension(built.dir)).resolves.toEqual({
          ok: true,
          problems: [],
        });
        if (withCode) {
          // the ids written by the build must accept the example as written
          await writeFile(path.join(root, 'tsconfig.json'), TSCONFIG);
          const { code, output } = await runTsc(root);
          expect(code, output).toBe(0);
        }
      });
    });
  }
});

interface Streak {
  days: number;
  last: string;
}

interface SdkTesting {
  createMemoryStorage(): {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  loadEvents(
    module: unknown,
    options: { storage: unknown; declared: string[] },
  ): Promise<{
    emit(name: string, payload: Record<string, unknown>): Promise<void>;
  }>;
  loadCommands(
    module: unknown,
    options: {
      storage: unknown;
      declaredCommands: string[];
      declaredPanels: string[];
    },
  ): Promise<{ run(id: string, args?: unknown): Promise<unknown> }>;
}

interface PanelModule {
  default: {
    mount(
      container: unknown,
      ctx: {
        panelId: string;
        call(id: string): Promise<unknown>;
        onProps(listener: () => void): () => void;
        signal: { addEventListener(type: string, fn: () => void): void };
      },
    ): Promise<void>;
  };
}

describe('пример «серия дней целиком» исполняется', () => {
  const attempt = (at: string) => ({
    exerciseId: 'e',
    courseId: 'c',
    lessonId: 'l',
    grade: 4,
    outcome: 'passed',
    source: 'runner',
    at: Date.parse(`${at}T12:00:00Z`),
  });

  it('событие считает серию, команды и панель читают те же данные', async () => {
    const files = examples.get('серия дней целиком') ?? [];
    const manifest = manifestOf(files) as {
      contributes: {
        commands: Array<{ id: string; palette?: boolean }>;
        panels: Array<{ id: string }>;
      };
    };
    const root = await writeProject(files, true);
    const built = await buildExtension({ root });
    await expect(validateExtension(built.dir)).resolves.toEqual({
      ok: true,
      problems: [],
    });

    const sdk = (await import(
      /* @vite-ignore */ path.join(
        REPO_ROOT,
        'packages/extension-sdk/src/testing.ts',
      )
    )) as SdkTesting;
    const module = (
      await import(/* @vite-ignore */ path.join(built.dir, 'main.mjs'))
    ).default as unknown;
    const storage = sdk.createMemoryStorage();
    const declaredCommands = manifest.contributes.commands.map(({ id }) => id);
    const declaredPanels = manifest.contributes.panels.map(({ id }) => id);
    const events = await sdk.loadEvents(module, {
      storage,
      declared: ['attempt.closed'],
    });
    const commands = await sdk.loadCommands(module, {
      storage,
      declaredCommands,
      declaredPanels,
    });

    // нет данных: команда палитры уведомляет, команда данных отдаёт нули
    expect(await commands.run('acme.streak.show')).toMatchObject({
      kind: 'notify',
    });
    expect(await commands.run('acme.streak.data')).toEqual({
      kind: 'data',
      value: { days: 0, last: '' },
    });

    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-02'));
    expect(await storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
    // пропущенный день начинает серию заново; «сдался» серию не трогает
    await events.emit('attempt.closed', {
      ...attempt('2026-10-03'),
      outcome: 'gave-up',
    });
    expect((await storage.get('streak')) as Streak).toMatchObject({ days: 2 });
    await events.emit('attempt.closed', attempt('2026-10-05'));
    expect(await storage.get('streak')).toEqual({
      days: 1,
      last: '2026-10-05',
    });

    expect(await commands.run('acme.streak.show')).toEqual({
      kind: 'openPanel',
      panelId: 'acme.streak.view',
      props: { days: 1 },
    });

    // собранная панель выполняется в «рамке» и рисует ответ команды данных
    const panel = (await import(
      /* @vite-ignore */ path.join(built.dir, 'panel.mjs')
    )) as PanelModule;
    const line = { textContent: '' };
    const container = {
      ownerDocument: { createElement: () => line },
      append: () => undefined,
    };
    await panel.default.mount(container, {
      panelId: 'acme.streak.view',
      call: async (id) => {
        const outcome = (await commands.run(id)) as { value: unknown };
        return outcome.value;
      },
      onProps: () => () => undefined,
      signal: { addEventListener: () => undefined },
    });
    expect(line.textContent).toBe('Серия: 1 дн., последний день 2026-10-05');
    expect(declaredCommands).toEqual(['acme.streak.show', 'acme.streak.data']);
  });
});
