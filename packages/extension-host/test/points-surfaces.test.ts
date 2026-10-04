import { formatDiagnostic } from '../src/diagnostics.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExtensions, inspectExtensionDir } from '../src/discover.ts';
import { parseManifest } from '../src/manifest.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { extMessageSchema } from '../src/protocol.ts';
import { contributesOf, createExtensionRegistry } from '../src/registry.ts';
import { createLogger, holderOf } from './helpers.ts';
import { stateful } from './state-harness.ts';

const ID = 'acme.surf';

const manifest = (
  contributes: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({ id: ID, version: '1.0.0', apiVersion: 1, contributes, ...extra });

const command = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.run`,
  title: 'Run',
  ...patch,
});

const panel = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.screen`,
  title: 'Screen',
  ...patch,
});

const messageOf = (raw: unknown): string => {
  const parsed = parseManifest(raw);
  if (parsed.ok) throw new Error('manifest was accepted');
  return formatDiagnostic(parsed.diagnostic);
};

describe('точка commands', () => {
  it('принимает полную запись; palette по умолчанию true; команды требуют код: main подставляется', () => {
    const parsed = parseManifest(
      manifest({
        commands: [
          command({
            description: 'Do it',
            category: 'Streak',
            keybinding: 'Mod+Shift+L',
            palette: false,
          }),
          command({ id: `${ID}.other` }),
        ],
      }),
    );

    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(parsed.manifest.main).toBe('./main.mjs');
    expect(parsed.manifest.contributes.commands).toEqual([
      {
        id: `${ID}.run`,
        title: 'Run',
        description: 'Do it',
        category: 'Streak',
        keybinding: 'Mod+Shift+L',
        palette: false,
      },
      { id: `${ID}.other`, title: 'Run', palette: true },
    ]);
  });

  it('ключ when зарезервирован: манифест с ним отклоняется и сообщение называет ключ', () => {
    const message = messageOf(manifest({ commands: [command({ when: 'x' })] }));

    expect(message).toContain('contributes.commands.0');
    expect(message).toContain('"when"');
  });

  it.each([
    [
      'id вне пространства расширения',
      command({ id: 'other.run' }),
      "id must be 'acme.surf'",
    ],
    ['пустое название', command({ title: '' }), 'title'],
    ['название 61 знак', command({ title: 'x'.repeat(61) }), 'title'],
    ['категория 41 знак', command({ category: 'x'.repeat(41) }), 'category'],
    [
      'описание 201 знак',
      command({ description: 'x'.repeat(201) }),
      'description',
    ],
    ['palette не булево', command({ palette: 'no' }), 'palette'],
    [
      'клавиши в нижнем регистре',
      command({ keybinding: 'mod+l' }),
      'Mod+Shift+L',
    ],
    ['клавиши без клавиши', command({ keybinding: 'Mod+' }), 'Mod+Shift+L'],
    [
      'четыре модификатора',
      command({ keybinding: 'Mod+Shift+Alt+Ctrl+L' }),
      'Mod+Shift+L',
    ],
    ['лишний ключ', command({ icon: 'x' }), 'icon'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(manifest({ commands: [entry] }))).toContain(fragment);
  });

  it('границы допустимы: название 60 знаков, категория 40, описание 200', () => {
    expect(
      parseManifest(
        manifest({
          commands: [
            command({
              title: 'x'.repeat(60),
              category: 'x'.repeat(40),
              description: 'x'.repeat(200),
            }),
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it('отклоняет повтор id внутри манифеста', () => {
    expect(messageOf(manifest({ commands: [command(), command()] }))).toContain(
      `contributes.commands.1.id: duplicate id '${ID}.run'`,
    );
  });

  it('не более 64 команд на расширение', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        command({ id: `${ID}.c${index}` }),
      );

    expect(parseManifest(manifest({ commands: many(64) })).ok).toBe(true);
    expect(messageOf(manifest({ commands: many(65) }))).toContain(
      'at most 64 commands',
    );
  });
});

describe('точка panels', () => {
  it('принимает панель; module по умолчанию ./panel.mjs; кода не требует: main = null', () => {
    const parsed = parseManifest(
      manifest({
        panels: [panel(), panel({ id: `${ID}.b`, module: './ui/b.js' })],
      }),
    );

    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(parsed.manifest.main).toBeNull();
    expect(parsed.manifest.contributes.panels).toEqual([
      { id: `${ID}.screen`, title: 'Screen', module: './panel.mjs' },
      { id: `${ID}.b`, title: 'Screen', module: './ui/b.js' },
    ]);
  });

  it.each([
    [
      'id вне пространства расширения',
      panel({ id: 'other.screen' }),
      "id must be 'acme.surf'",
    ],
    ['пустое название', panel({ title: '' }), 'title'],
    ['название 61 знак', panel({ title: 'x'.repeat(61) }), 'title'],
    [
      'module не .js/.mjs',
      panel({ module: './panel.ts' }),
      'must end with .js or .mjs',
    ],
    [
      'module выходит из каталога',
      panel({ module: '../panel.mjs' }),
      'safe relative path',
    ],
    [
      'абсолютный module',
      panel({ module: '/panel.mjs' }),
      'safe relative path',
    ],
    ['лишний ключ', panel({ icon: 'x' }), 'icon'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(manifest({ panels: [entry] }))).toContain(fragment);
  });

  it('отклоняет повтор id и более 8 панелей', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        panel({ id: `${ID}.p${index}` }),
      );

    expect(messageOf(manifest({ panels: [panel(), panel()] }))).toContain(
      `contributes.panels.1.id: duplicate id '${ID}.screen'`,
    );
    expect(parseManifest(manifest({ panels: many(8) })).ok).toBe(true);
    expect(messageOf(manifest({ panels: many(9) }))).toContain(
      'at most 8 panels',
    );
  });

  it('команды и панели не требуют разрешений', () => {
    expect(
      parseManifest(manifest({ commands: [command()], panels: [panel()] })).ok,
    ).toBe(true);
  });
});

describe('обнаружение и реестр команд и панелей', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dolphy-surfaces-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const write = async (
    id: string,
    contributes: Record<string, unknown>,
    files: string[] = ['main.mjs', 'panel.mjs'],
  ) => {
    await mkdir(path.join(root, id), { recursive: true });
    await writeFile(
      path.join(root, id, 'extension.json'),
      JSON.stringify({ id, version: '1.0.0', apiVersion: 1, contributes }),
    );
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, id, file)), { recursive: true });
      await writeFile(path.join(root, id, file), 'export default {};');
    }
  };

  const discover = () =>
    discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
    });

  it('адрес модуля панели и вклады в реестре: панель всегда в рамке, даже у доверенного расширения', async () => {
    await write(
      ID,
      {
        commands: [command({ keybinding: 'Mod+K' })],
        panels: [panel({ module: './ui/screen.js' })],
      },
      ['main.mjs', 'ui/screen.js'],
    );
    const found = await discover();
    const holder = holderOf(found.extensions);
    const policy = createExtensionPolicy(holder);
    policy.update({ disabled: [], trusted: [ID], checkUpdates: true });

    const registry = createExtensionRegistry(holder, policy);
    const contributions = registry.contributions();

    expect(contributions.commands).toEqual([
      {
        id: `${ID}.run`,
        extensionId: ID,
        title: 'Run',
        description: null,
        category: null,
        keybinding: 'Mod+K',
        palette: true,
      },
    ]);
    expect(contributions.panels).toEqual([
      {
        id: `${ID}.screen`,
        extensionId: ID,
        title: 'Screen',
        rendererUrl: `dolphy-ext://${ID}/ui/screen.js`,
        isolated: true,
        origin: 'user',
        revision: expect.stringMatching(/./) as unknown as string,
      },
    ]);
    expect(registry.list()[0]?.contributes).toMatchObject({
      commands: [`${ID}.run`],
      panels: [`${ID}.screen`],
    });
  });

  it('отключённое расширение не даёт ни команд, ни панелей', async () => {
    await write(ID, { commands: [command()], panels: [panel()] });
    const holder = holderOf((await discover()).extensions);
    const policy = createExtensionPolicy(holder);
    policy.update({ disabled: [ID], trusted: [], checkUpdates: true });

    const contributions = createExtensionRegistry(
      holder,
      policy,
    ).contributions();

    expect(contributions.commands).toEqual([]);
    expect(contributions.panels).toEqual([]);
  });

  it('нет файла модуля панели — расширение пропускается с понятным сообщением', async () => {
    await write(ID, { panels: [panel()] }, []);

    const found = await discover();

    expect(found.extensions).toEqual([]);
    expect(found.diagnostics).toEqual([
      {
        extensionId: ID,
        origin: 'user',
        diagnostic: {
          code: 'load-failed',
          data: {
            reason: "panel module './panel.mjs' (default) is not a file",
          },
        },
      },
    ]);
  });

  it('нет main у расширения с командами — расширение пропускается', async () => {
    await write(ID, { commands: [command()] }, ['panel.mjs']);

    const found = await discover();

    expect(formatDiagnostic(found.diagnostics[0]!.diagnostic)).toContain(
      "main './main.mjs'",
    );
  });

  it('id команды и панели занимает одно расширение: другое, чьё пространство пересекается, пропускается', async () => {
    // `acme` вправе называть команды `acme.b.*`, как и расширение `acme.b`
    await write('acme', {
      commands: [command({ id: 'acme.b.run' })],
      panels: [panel({ id: 'acme.c.screen' })],
    });
    await write('acme.b', { commands: [command({ id: 'acme.b.run' })] });
    await write('acme.c', { panels: [panel({ id: 'acme.c.screen' })] });

    const found = await discover();

    expect(found.extensions.map(({ id }) => id)).toEqual(['acme']);
    expect(
      found.diagnostics
        .map(({ diagnostic }) => formatDiagnostic(diagnostic))
        .sort(),
    ).toEqual([
      "command 'acme.b.run' is already provided by 'acme'",
      "panel 'acme.c.screen' is already provided by 'acme'",
    ]);
  });

  it('contributesOf: идентификаторы команд и панелей как в записи каталога', () => {
    const extension = stateful(ID, {
      commands: [
        {
          id: `${ID}.run`,
          title: 'Run',
          description: null,
          category: null,
          keybinding: null,
          palette: true,
        },
      ],
      panels: [{ id: `${ID}.screen`, title: 'S', rendererUrl: 'x' }],
    });

    expect(contributesOf(extension)).toMatchObject({
      commands: [`${ID}.run`],
      panels: [`${ID}.screen`],
    });
  });

  it('inspectExtensionDir разбирает команды и панели без обращения к хосту', async () => {
    await write(ID, { commands: [command()], panels: [panel()] });

    const result = await inspectExtensionDir(path.join(root, ID));

    if (!result.ok) throw new Error(formatDiagnostic(result.diagnostic));
    expect(result.extension.commands.map(({ id }) => id)).toEqual([
      `${ID}.run`,
    ]);
    expect(result.extension.panels[0]?.rendererUrl).toBe(
      `dolphy-ext://${ID}/panel.mjs`,
    );
  });
});

describe('протокол замены набора расширений', () => {
  const replace = (extensions: unknown[]) => ({
    id: 'r1',
    method: 'replaceExtensions',
    params: { extensions },
  });

  it('принимает набор с командами и панелями', () => {
    const extension = stateful(ID, {
      commands: [
        {
          id: `${ID}.run`,
          title: 'Run',
          description: null,
          category: null,
          keybinding: null,
          palette: true,
        },
      ],
      panels: [{ id: `${ID}.screen`, title: 'S', rendererUrl: 'x' }],
    });

    expect(extMessageSchema.safeParse(replace([extension])).success).toBe(true);
  });

  it.each(['commands', 'panels'])(
    'набор, где у расширения нет массива %s, отвергается целиком (иначе хост принял бы набор без новых вкладов)',
    (key) => {
      // ключ отсутствует вовсе, а не равен undefined
      const rest = Object.fromEntries(
        Object.entries(stateful(ID)).filter(([name]) => name !== key),
      );
      const other = stateful('acme.other');

      expect(extMessageSchema.safeParse(replace([other, rest])).success).toBe(
        false,
      );
    },
  );

  it('принимает вызов invokeCommand с аргументами и без них, отвергает лишние ключи', () => {
    const call = (params: Record<string, unknown>) =>
      extMessageSchema.safeParse({ id: '1', method: 'invokeCommand', params })
        .success;
    const base = { extensionId: ID, commandId: `${ID}.run`, isolated: false };

    expect(call(base)).toBe(true);
    expect(call({ ...base, args: { a: [1] } })).toBe(true);
    expect(call({ ...base, extra: 1 })).toBe(false);
    expect(call({ extensionId: ID, commandId: `${ID}.run` })).toBe(false);
  });
});
