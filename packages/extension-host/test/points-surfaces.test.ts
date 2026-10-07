import { formatDiagnostic } from '../src/diagnostics.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExtensions, inspectExtensionDir } from '../src/discover.ts';
import { parseManifest } from '../src/manifest.ts';
import { commands } from '../src/points/commands.ts';
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

const widget = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.card`,
  title: 'Card',
  slot: 'dailyPlan',
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
            palette: true,
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
        palette: true,
        icon: 'puzzle',
      },
      { id: `${ID}.other`, title: 'Run', palette: true, icon: 'puzzle' },
    ]);
  });

  it('значок: из закрытого списка, без него — puzzle; неизвестное имя — ошибка манифеста', () => {
    const parsed = parseManifest(
      manifest({
        commands: [command({ icon: 'fire' }), command({ id: `${ID}.b` })],
      }),
    );
    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(
      parsed.manifest.contributes.commands.map(({ icon }) => icon),
    ).toEqual(['fire', 'puzzle']);
    expect(
      messageOf(manifest({ commands: [command({ icon: 'rocket' })] })),
    ).toContain('contributes.commands.0.icon');
    expect(
      messageOf(manifest({ commands: [command({ icon: 'mdi-fire' })] })),
    ).toContain('contributes.commands.0.icon');
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

  describe('привязки клавиш', () => {
    const accepted = (patch: Record<string, unknown>) => {
      const parsed = parseManifest(manifest({ commands: [command(patch)] }));
      if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
      return parsed.manifest.contributes.commands;
    };

    it('принимает сокращение и записи keybindings с ключами платформ и when', () => {
      const list = accepted({
        keybinding: 'Mod+K Mod+S',
        keybindings: [
          { key: 'Mod+Shift+O', mac: 'Mod+Alt+O' },
          { key: 'Mod+Shift+P', windows: 'Ctrl+Alt+P', when: "page == 'x'" },
          { key: 'Escape', when: '!inputFocus && paletteOpen' },
        ],
      });

      expect(list?.[0]?.keybindings).toHaveLength(3);
    });

    it('resolve: пропущенные поля — null, отсутствие keybindings — []', async () => {
      const resolved = await commands.resolve(
        [
          { id: `${ID}.a`, title: 'A', palette: true, icon: 'puzzle' },
          {
            id: `${ID}.b`,
            title: 'B',
            palette: true,
            icon: 'puzzle',
            keybindings: [{ key: 'Mod+Shift+O', mac: 'Mod+Alt+O' }],
          },
        ],
        {} as never,
      );

      expect(resolved[0]).toMatchObject({ keybinding: null, keybindings: [] });
      expect(resolved[1]?.keybindings).toEqual([
        {
          key: 'Mod+Shift+O',
          mac: 'Mod+Alt+O',
          windows: null,
          linux: null,
          when: null,
        },
      ]);
    });

    it.each([
      [
        'ключ неверен на одной платформе',
        { keybindings: [{ key: 'Mod+Ctrl+K' }] },
        'contributes.commands.0.keybindings.0.key: invalid key (repeated-modifier)',
      ],
      [
        'ключ платформы неверен',
        { keybindings: [{ key: 'Mod+K', mac: 'Mod+Cmd+K' }] },
        'contributes.commands.0.keybindings.0.mac: invalid key',
      ],
      [
        'сокращение неверно на одной платформе',
        { keybinding: 'Mod+Ctrl+K' },
        'contributes.commands.0.keybinding: invalid key',
      ],
      [
        'печатающая клавиша без when',
        { keybindings: [{ key: 'Shift+A' }] },
        'contributes.commands.0.keybindings.0.when: a key that types text',
      ],
      [
        'печатающая клавиша в сокращении',
        { keybinding: 'A' },
        'contributes.commands.0.keybinding: a key that types text',
      ],
      [
        'печатающая клавиша при when, активном в поле ввода',
        { keybindings: [{ key: 'A', when: 'inputFocus' }] },
        'a key that types text',
      ],
      [
        'неверный when',
        { keybindings: [{ key: 'Mod+K', when: 'page ==' }] },
        'contributes.commands.0.keybindings.0.when: invalid "when"',
      ],
      [
        'больше 4 записей',
        {
          keybindings: ['1', '2', '3', '4', '5'].map((key) => ({
            key: `Mod+${key}`,
          })),
        },
        'keybindings',
      ],
      [
        'привязка при palette: false',
        { keybinding: 'Mod+K', palette: false },
        'contributes.commands.0.palette: keybindings need palette: true',
      ],
      [
        'повтор (key, when) в команде',
        {
          keybindings: [
            { key: 'Mod+K', when: "page == 'x'" },
            { key: 'Mod+K', when: "page == 'x'" },
          ],
        },
        'contributes.commands.0.keybindings.1.key: duplicate binding',
      ],
      [
        'сокращение повторяет запись',
        { keybinding: 'Mod+K', keybindings: [{ key: 'Mod+K' }] },
        'contributes.commands.0.keybindings.0.key: duplicate binding',
      ],
      [
        'лишний ключ записи',
        { keybindings: [{ key: 'Mod+K', command: 'x' }] },
        'command',
      ],
    ])('отклоняет: %s', (_name, patch, fragment) => {
      expect(messageOf(manifest({ commands: [command(patch)] }))).toContain(
        fragment,
      );
    });

    it('одинаковый ключ с разными when допустим', () => {
      expect(
        accepted({
          keybindings: [
            { key: 'Mod+K', when: "page == 'a'" },
            { key: 'Mod+K', when: "page == 'b'" },
          ],
        }),
      ).toHaveLength(1);
    });
  });
});

describe('условие when у команды, панели и виджета', () => {
  const entryOf = {
    commands: (patch: Record<string, unknown>) => command(patch),
    panels: (patch: Record<string, unknown>) => panel(patch),
    widgets: (patch: Record<string, unknown>) => widget(patch),
  } as const;

  it.each(Object.keys(entryOf) as (keyof typeof entryOf)[])(
    '%s: принимает условие; без условия поля нет',
    (key) => {
      const text = "route == 'courses' && !session.active";
      const parsed = parseManifest(
        manifest({
          [key]: [
            entryOf[key]({ when: text }),
            entryOf[key]({ id: `${ID}.other` }),
          ],
        }),
      );
      if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
      expect(
        parsed.manifest.contributes[key].map((entry) => entry.when),
      ).toEqual([text, undefined]);
    },
  );

  it.each([
    ['неизвестный ключ', "foo == 'x'", "unknown key 'foo' (known:", 'at 0'],
    ['ключ другого реестра', 'inputFocus', "unknown key 'inputFocus'", 'at 0'],
    ['неизвестное значение', "route == 'home'", "unknown value 'home'", 'at 9'],
    [
      'несовпадение типа',
      "course.active == 'yes'",
      "'course.active' is a boolean",
      'at 17',
    ],
    ['синтаксис', 'route ==', 'end of the condition', 'at 8'],
    ['одиночный &', 'course.active & session.active', "character '&'", 'at 14'],
  ])('отклоняет: %s, сообщение с позицией', (_name, when, cause, position) => {
    for (const key of ['commands', 'panels', 'widgets'] as const) {
      const message = messageOf(manifest({ [key]: [entryOf[key]({ when })] }));
      expect(message).toContain(`contributes.${key}.0.when`);
      expect(message).toContain('invalid "when"');
      expect(message).toContain(cause);
      expect(message).toContain(position);
    }
  });

  it('позиция в сообщении указывает запись списка', () => {
    const message = messageOf(
      manifest({
        panels: [panel(), panel({ id: `${ID}.b`, when: 'nope' })],
      }),
    );
    expect(message).toContain('contributes.panels.1.when');
  });

  it('длина условия: 200 знаков допустимы, 201 — ошибка', () => {
    const fits = `course.active${' '.repeat(187)}`;
    expect(fits).toHaveLength(200);
    expect(
      parseManifest(manifest({ commands: [command({ when: fits })] })).ok,
    ).toBe(true);
    expect(
      messageOf(manifest({ commands: [command({ when: `${fits} ` })] })),
    ).toContain('contributes.commands.0.when');
  });

  it('пустое условие — ошибка', () => {
    expect(messageOf(manifest({ widgets: [widget({ when: '' })] }))).toContain(
      'contributes.widgets.0.when',
    );
  });

  it('команда с palette: false может иметь условие: оно скрывает только строку палитры, которой нет', () => {
    const parsed = parseManifest(
      manifest({
        commands: [command({ palette: false, when: 'course.active' })],
      }),
    );
    expect(parsed.ok).toBe(true);
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
      {
        id: `${ID}.screen`,
        title: 'Screen',
        module: './panel.mjs',
        icon: 'puzzle',
      },
      { id: `${ID}.b`, title: 'Screen', module: './ui/b.js', icon: 'puzzle' },
    ]);
  });

  it('значок: из закрытого списка, без него — puzzle; неизвестное имя — ошибка манифеста', () => {
    const parsed = parseManifest(
      manifest({
        panels: [panel({ icon: 'trophy' }), panel({ id: `${ID}.b` })],
      }),
    );
    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(parsed.manifest.contributes.panels.map(({ icon }) => icon)).toEqual([
      'trophy',
      'puzzle',
    ]);
    expect(
      messageOf(manifest({ panels: [panel({ icon: 'rocket' })] })),
    ).toContain('contributes.panels.0.icon');
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
    ['лишний ключ', panel({ extra: 1 }), 'extra'],
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

describe('точка widgets', () => {
  it('принимает виджет; module по умолчанию ./widget.mjs; кода не требует: main = null', () => {
    const parsed = parseManifest(
      manifest({
        widgets: [widget(), widget({ id: `${ID}.b`, module: './ui/b.js' })],
      }),
    );

    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(parsed.manifest.main).toBeNull();
    expect(parsed.manifest.contributes.widgets).toEqual([
      {
        id: `${ID}.card`,
        title: 'Card',
        slot: 'dailyPlan',
        module: './widget.mjs',
      },
      {
        id: `${ID}.b`,
        title: 'Card',
        slot: 'dailyPlan',
        module: './ui/b.js',
      },
    ]);
  });

  it.each([
    [
      'id вне пространства расширения',
      widget({ id: 'other.card' }),
      "id must be 'acme.surf'",
    ],
    ['пустое название', widget({ title: '' }), 'title'],
    ['название 61 знак', widget({ title: 'x'.repeat(61) }), 'title'],
    ['нет места', widget({ slot: undefined }), 'slot'],
    ['неизвестное место', widget({ slot: 'sidebar' }), 'slot'],
    ['высота больше не поле', widget({ minHeight: 100 }), 'minHeight'],
    [
      'module не .js/.mjs',
      widget({ module: './widget.ts' }),
      'must end with .js or .mjs',
    ],
    [
      'module выходит из каталога',
      widget({ module: '../widget.mjs' }),
      'safe relative path',
    ],
    ['лишний ключ', widget({ icon: 'puzzle' }), 'icon'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(manifest({ widgets: [entry] }))).toContain(fragment);
  });

  it('отклоняет повтор id и более 3 виджетов', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        widget({ id: `${ID}.w${index}` }),
      );

    expect(messageOf(manifest({ widgets: [widget(), widget()] }))).toContain(
      `contributes.widgets.1.id: duplicate id '${ID}.card'`,
    );
    expect(parseManifest(manifest({ widgets: many(3) })).ok).toBe(true);
    expect(messageOf(manifest({ widgets: many(4) }))).toContain(
      'at most 3 widgets',
    );
  });

  it('виджет не требует разрешений и основного файла', () => {
    expect(parseManifest(manifest({ widgets: [widget()] })).ok).toBe(true);
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
    policy.update({
      disabled: [],
      trusted: [ID],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });

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
        keybindings: [],
        when: null,
        palette: true,
        icon: 'puzzle',
      },
    ]);
    expect(contributions.panels).toEqual([
      {
        id: `${ID}.screen`,
        extensionId: ID,
        title: 'Screen',
        icon: 'puzzle',
        when: null,
        rendererUrl: `dolphy-ext://${ID}/ui/screen.js`,
        origin: 'user',
        revision: expect.stringMatching(/./) as unknown as string,
      },
    ]);
    expect(registry.list()[0]?.contributes).toMatchObject({
      commands: [`${ID}.run`],
      panels: [`${ID}.screen`],
    });
  });

  it('виджет: адрес модуля и вклад в реестре, у доверенного расширения те же', async () => {
    await write(ID, { widgets: [widget()] }, ['widget.mjs']);
    const holder = holderOf((await discover()).extensions);
    const policy = createExtensionPolicy(holder);
    policy.update({
      disabled: [],
      trusted: [ID],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });

    const registry = createExtensionRegistry(holder, policy);

    expect(registry.contributions().widgets).toEqual([
      {
        id: `${ID}.card`,
        extensionId: ID,
        title: 'Card',
        slot: 'dailyPlan',
        when: null,
        rendererUrl: `dolphy-ext://${ID}/widget.mjs`,
        origin: 'user',
        revision: expect.stringMatching(/./) as unknown as string,
      },
    ]);
    expect(registry.list()[0]?.contributes).toMatchObject({
      widgets: [`${ID}.card`],
    });
    expect(registry.list()[0]?.titles).toMatchObject({
      widgets: { [`${ID}.card`]: 'Card' },
    });
  });

  it('when команды, панели и виджета доходит до вкладов окна; без условия — null', async () => {
    const text = "route == 'courses'";
    await write(
      ID,
      {
        commands: [command({ when: text }), command({ id: `${ID}.plain` })],
        panels: [panel({ when: text }), panel({ id: `${ID}.plain` })],
        widgets: [widget({ when: text }), widget({ id: `${ID}.plain` })],
      },
      ['main.mjs', 'panel.mjs', 'widget.mjs'],
    );
    const holder = holderOf((await discover()).extensions);
    const policy = createExtensionPolicy(holder);

    const contributions = createExtensionRegistry(
      holder,
      policy,
    ).contributions();

    expect(contributions.commands.map(({ when }) => when)).toEqual([
      text,
      null,
    ]);
    expect(contributions.panels.map(({ when }) => when)).toEqual([text, null]);
    expect(contributions.widgets.map(({ when }) => when)).toEqual([text, null]);
  });

  it('нет файла модуля виджета — расширение пропускается с понятным сообщением', async () => {
    await write(ID, { widgets: [widget()] }, []);

    const found = await discover();

    expect(found.extensions).toEqual([]);
    expect(formatDiagnostic(found.diagnostics[0]!.diagnostic)).toContain(
      "widget module './widget.mjs' (default) is not a file",
    );
  });

  it('отключённое расширение не даёт ни команд, ни панелей, ни виджетов', async () => {
    await write(
      ID,
      { commands: [command()], panels: [panel()], widgets: [widget()] },
      ['main.mjs', 'panel.mjs', 'widget.mjs'],
    );
    const holder = holderOf((await discover()).extensions);
    const policy = createExtensionPolicy(holder);
    policy.update({
      disabled: [ID],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });

    const contributions = createExtensionRegistry(
      holder,
      policy,
    ).contributions();

    expect(contributions.commands).toEqual([]);
    expect(contributions.panels).toEqual([]);
    expect(contributions.widgets).toEqual([]);
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
          keybindings: [],
          when: null,
          icon: 'puzzle',
          palette: true,
        },
      ],
      panels: [
        {
          id: `${ID}.screen`,
          title: 'S',
          icon: 'puzzle',
          when: null,
          rendererUrl: 'x',
        },
      ],
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
          keybindings: [],
          when: null,
          icon: 'puzzle',
          palette: true,
        },
      ],
      panels: [
        {
          id: `${ID}.screen`,
          title: 'S',
          icon: 'puzzle',
          when: null,
          rendererUrl: 'x',
        },
      ],
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
