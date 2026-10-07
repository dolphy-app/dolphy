import { formatDiagnostic } from '../src/diagnostics.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import { createDiscoveryHolder } from '../src/holder.ts';
import { parseManifest } from '../src/manifest.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { extMessageSchema } from '../src/protocol.ts';
import { contributesOf, createExtensionRegistry } from '../src/registry.ts';
import { createLogger } from './helpers.ts';
import { stateful } from './state-harness.ts';

const ID = 'acme.pt';

const manifest = (
  contributes: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  id: ID,
  version: '1.0.0',
  apiVersion: 1,
  contributes,
  ...extra,
});

const setting = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.volume`,
  type: 'number',
  label: 'Volume',
  default: 5,
  min: 0,
  max: 10,
  ...patch,
});

const messageOf = (raw: unknown): string => {
  const parsed = parseManifest(raw);
  if (parsed.ok) throw new Error('manifest was accepted');
  return formatDiagnostic(parsed.diagnostic);
};

describe('точка settings', () => {
  it('принимает все четыре вида, данные без кода main не требуют', () => {
    const parsed = parseManifest(
      manifest({
        settings: [
          { id: ID, type: 'boolean', label: 'On', default: true },
          {
            id: `${ID}.name`,
            type: 'string',
            label: 'Name',
            description: 'Shown to you',
            default: 'abc',
            maxLength: 5,
          },
          setting({ integer: true }),
          {
            id: `${ID}.mode`,
            type: 'enum',
            label: 'Mode',
            default: 'b',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.main).toBeNull();
  });

  it.each([
    [
      'чужое пространство id',
      setting({ id: 'other.volume' }),
      "id must be 'acme.pt'",
    ],
    ['default не того типа', setting({ default: '5' }), 'default'],
    [
      'default ниже min',
      setting({ default: -1 }),
      'default is less than min 0',
    ],
    [
      'default выше max',
      setting({ default: 11 }),
      'default is greater than max 10',
    ],
    [
      'нецелый default при integer',
      setting({ integer: true, default: 2.5 }),
      'default must be an integer',
    ],
    [
      'min больше max',
      setting({ min: 9, max: 1, default: 5 }),
      'min is greater than max',
    ],
    [
      'default строки длиннее maxLength',
      {
        id: `${ID}.s`,
        type: 'string',
        label: 'S',
        default: 'abcdef',
        maxLength: 5,
      },
      'default is longer than 5 characters',
    ],
    [
      'default enum не из options',
      {
        id: `${ID}.e`,
        type: 'enum',
        label: 'E',
        default: 'c',
        options: [{ value: 'a', label: 'A' }],
      },
      "default 'c' is not an option",
    ],
    [
      'повтор значений в options',
      {
        id: `${ID}.e`,
        type: 'enum',
        label: 'E',
        default: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'A2' },
        ],
      },
      "duplicate value 'a'",
    ],
    [
      'enum без вариантов',
      { id: `${ID}.e`, type: 'enum', label: 'E', default: 'a', options: [] },
      'options',
    ],
    ['неизвестный ключ', setting({ step: 1 }), 'step'],
    [
      'неизвестный тип',
      { id: `${ID}.x`, type: 'date', label: 'X', default: '' },
      'type',
    ],
    [
      'default text длиннее maxLength',
      {
        id: `${ID}.t`,
        type: 'text',
        label: 'T',
        default: 'abcdef',
        maxLength: 5,
      },
      'default is longer than 5 characters',
    ],
    [
      'maxLength text сверх потолка',
      {
        id: `${ID}.t`,
        type: 'text',
        label: 'T',
        default: '',
        maxLength: 10_001,
      },
      'maxLength',
    ],
    [
      'цвет не #rrggbb',
      { id: `${ID}.c`, type: 'color', label: 'C', default: '#fff' },
      'must be #rrggbb',
    ],
    [
      'default списка длиннее maxItems',
      {
        id: `${ID}.l`,
        type: 'list',
        label: 'L',
        default: ['a', 'b', 'c'],
        maxItems: 2,
      },
      'default has more than 2 items',
    ],
    [
      'элемент default списка длиннее itemMaxLength',
      {
        id: `${ID}.l`,
        type: 'list',
        label: 'L',
        default: ['abcdef'],
        itemMaxLength: 5,
      },
      'default has an item longer than 5 characters',
    ],
    [
      'maxItems списка сверх потолка',
      { id: `${ID}.l`, type: 'list', label: 'L', default: [], maxItems: 51 },
      'maxItems',
    ],
    [
      'itemMaxLength списка сверх потолка',
      {
        id: `${ID}.l`,
        type: 'list',
        label: 'L',
        default: [],
        itemMaxLength: 201,
      },
      'itemMaxLength',
    ],
    ['пустой group', setting({ group: '' }), 'group'],
    ['group длиннее 60', setting({ group: 'g'.repeat(61) }), 'group'],
    ['order ниже 0', setting({ order: -1 }), 'order'],
    ['order выше 1000', setting({ order: 1001 }), 'order'],
    ['нецелый order', setting({ order: 1.5 }), 'order'],
    [
      'maxLength сверх потолка',
      {
        id: `${ID}.s`,
        type: 'string',
        label: 'S',
        default: '',
        maxLength: 10_001,
      },
      'maxLength',
    ],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(manifest({ settings: [entry] }))).toContain(fragment);
  });

  describe('visibleWhen', () => {
    const flag = {
      id: `${ID}.flag`,
      type: 'boolean',
      label: 'F',
      default: false,
    };
    const gated = (visibleWhen: unknown, extra: Record<string, unknown> = {}) =>
      setting({ visibleWhen, ...extra });

    it('принимает ссылку на boolean, enum, string и number того же расширения', () => {
      const parsed = parseManifest(
        manifest({
          settings: [
            flag,
            { id: `${ID}.n`, type: 'number', label: 'N', default: 1 },
            { id: `${ID}.s`, type: 'string', label: 'S', default: '' },
            {
              id: `${ID}.e`,
              type: 'enum',
              label: 'E',
              default: 'a',
              options: [{ value: 'a', label: 'A' }],
            },
            gated({ setting: `${ID}.flag`, equals: true }),
            setting({
              id: `${ID}.v2`,
              visibleWhen: { setting: `${ID}.n`, equals: 3 },
            }),
            setting({
              id: `${ID}.v3`,
              visibleWhen: { setting: `${ID}.s`, equals: 'x' },
            }),
            setting({
              id: `${ID}.v4`,
              visibleWhen: { setting: `${ID}.e`, equals: 'a' },
            }),
          ],
        }),
      );
      expect(parsed.ok).toBe(true);
    });

    it.each([
      [
        'несуществующая настройка',
        [gated({ setting: `${ID}.ghost`, equals: true })],
        "unknown setting 'acme.pt.ghost'",
      ],
      [
        'сама на себя',
        [gated({ setting: `${ID}.volume`, equals: 5 })],
        'cannot depend on itself',
      ],
      [
        'цикл',
        [
          setting({
            id: `${ID}.a`,
            visibleWhen: { setting: `${ID}.b`, equals: 5 },
          }),
          setting({
            id: `${ID}.b`,
            visibleWhen: { setting: `${ID}.a`, equals: 5 },
          }),
        ],
        'chains and cycles are not allowed',
      ],
      [
        'цепочка',
        [
          flag,
          setting({
            id: `${ID}.a`,
            visibleWhen: { setting: `${ID}.flag`, equals: true },
          }),
          setting({
            id: `${ID}.b`,
            visibleWhen: { setting: `${ID}.a`, equals: 5 },
          }),
        ],
        'chains and cycles are not allowed',
      ],
      [
        'список как условие',
        [
          { id: `${ID}.l`, type: 'list', label: 'L', default: [] },
          gated({ setting: `${ID}.l`, equals: 'x' }),
        ],
        'is a list',
      ],
      [
        'equals другого типа',
        [flag, gated({ setting: `${ID}.flag`, equals: 'yes' })],
        'must be a boolean',
      ],
      [
        'число против строки',
        [
          setting(),
          gated({ setting: `${ID}.volume`, equals: '5' }, { id: `${ID}.v` }),
        ],
        'must be a number',
      ],
      [
        'чужая настройка',
        [gated({ setting: 'other.flag', equals: true })],
        "unknown setting 'other.flag'",
      ],
    ])('отклоняет: %s', (_name, settings, fragment) => {
      expect(messageOf(manifest({ settings }))).toContain(fragment);
    });
  });

  it('отклоняет повтор id внутри манифеста', () => {
    expect(
      messageOf(
        manifest({ settings: [setting(), setting({ label: 'Again' })] }),
      ),
    ).toContain("contributes.settings.1.id: duplicate id 'acme.pt.volume'");
  });
});

describe('точка events', () => {
  it('принимает три события без разрешений и подставляет main (событиям нужен код)', () => {
    const parsed = parseManifest(
      manifest({
        events: [
          { event: 'session.started' },
          { event: 'session.finished' },
          { event: 'attempt.closed' },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.main).toBe('./main.mjs');
  });

  it.each([
    ['неизвестное событие', [{ event: 'attempt.opened' }], 'event'],
    [
      'повтор события',
      [{ event: 'attempt.closed' }, { event: 'attempt.closed' }],
      "duplicate event 'attempt.closed'",
    ],
    ['лишний ключ', [{ event: 'attempt.closed', filter: 1 }], 'filter'],
  ])('отклоняет: %s', (_name, events, fragment) => {
    expect(messageOf(manifest({ events }))).toContain(fragment);
  });
});

describe('обнаружение и реестр', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dolphy-points-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const write = async (id: string, contributes: Record<string, unknown>) => {
    await mkdir(path.join(root, id));
    await writeFile(
      path.join(root, id, 'extension.json'),
      JSON.stringify({ id, version: '1.0.0', apiVersion: 1, contributes }),
    );
  };

  it('id настройки занимает одно расширение: другое, чьё пространство пересекается, пропускается', async () => {
    // `acme` вправе называть настройки `acme.b.*`, как и расширение `acme.b`
    await write('acme', { settings: [setting({ id: 'acme.b.volume' })] });
    await write('acme.b', { settings: [setting({ id: 'acme.b.volume' })] });

    const found = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
    });

    expect(found.extensions.map(({ id }) => id)).toEqual(['acme']);
    expect(found.diagnostics).toEqual([
      {
        extensionId: 'acme.b',
        origin: 'user',
        diagnostic: {
          code: 'claim-clash',
          data: { kind: 'setting', name: 'acme.b.volume', by: 'acme' },
        },
      },
    ]);
  });

  it('определения настроек разобраны в вид окна; в реестр попадают только включённые расширения', async () => {
    await write('acme.a', {
      settings: [
        setting({ id: 'acme.a', description: 'How loud' }),
        { id: 'acme.a.on', type: 'boolean', label: 'On', default: false },
      ],
    });
    await write('acme.b', { settings: [setting({ id: 'acme.b' })] });
    const found = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
    });
    const discovery = createDiscoveryHolder(found);
    const policy = createExtensionPolicy(discovery);
    const registry = createExtensionRegistry(discovery, policy);
    policy.update({
      disabled: ['acme.b'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });

    expect(registry.contributions().settings).toEqual([
      {
        extensionId: 'acme.a',
        id: 'acme.a',
        type: 'number',
        label: 'Volume',
        description: 'How loud',
        group: null,
        order: 0,
        visibleWhen: null,
        default: 5,
        min: 0,
        max: 10,
        integer: false,
      },
      {
        extensionId: 'acme.a',
        id: 'acme.a.on',
        type: 'boolean',
        label: 'On',
        description: null,
        group: null,
        order: 0,
        visibleWhen: null,
        default: false,
      },
    ]);
    expect(
      registry.list().map(({ id, contributes }) => [id, contributes.settings]),
    ).toEqual([
      ['acme.a', ['acme.a', 'acme.a.on']],
      ['acme.b', ['acme.b']],
    ]);
  });

  it('принимает text, color и list; цвет в разрешённом виде — нижнего регистра', async () => {
    await write('acme.rich', {
      settings: [
        {
          id: 'acme.rich.note',
          type: 'text',
          label: 'Note',
          default: 'a\nb',
          maxLength: 10,
        },
        {
          id: 'acme.rich.tint',
          type: 'color',
          label: 'Tint',
          default: '#AaBb0C',
        },
        { id: 'acme.rich.tags', type: 'list', label: 'Tags', default: ['x'] },
        {
          id: 'acme.rich.few',
          type: 'list',
          label: 'Few',
          default: [],
          maxItems: 2,
          itemMaxLength: 7,
        },
      ],
    });
    const found = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
    });
    const registry = createExtensionRegistry(
      createDiscoveryHolder(found),
      createExtensionPolicy(createDiscoveryHolder(found)),
    );
    expect(
      registry
        .contributions()
        .settings.map(({ id, type, default: d, ...rest }) => [
          id,
          type,
          d,
          rest,
        ]),
    ).toMatchObject([
      ['acme.rich.note', 'text', 'a\nb', { maxLength: 10 }],
      ['acme.rich.tint', 'color', '#aabb0c', {}],
      ['acme.rich.tags', 'list', ['x'], { maxItems: 50, itemMaxLength: 200 }],
      ['acme.rich.few', 'list', [], { maxItems: 2, itemMaxLength: 7 }],
    ]);
  });

  it('group, order и visibleWhen доходят до окна; без них — null, 0, null', async () => {
    await write('acme.form', {
      settings: [
        { id: 'acme.form.on', type: 'boolean', label: 'On', default: false },
        {
          id: 'acme.form.mode',
          type: 'enum',
          label: 'Mode',
          default: 'a',
          options: [{ value: 'a', label: 'A' }],
          group: 'Advanced',
          order: 7,
          visibleWhen: { setting: 'acme.form.on', equals: true },
        },
      ],
    });
    const found = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
    });
    const holder = createDiscoveryHolder(found);
    const registry = createExtensionRegistry(
      holder,
      createExtensionPolicy(holder),
    );
    expect(
      registry
        .contributions()
        .settings.map(({ group, order, visibleWhen }) => ({
          group,
          order,
          visibleWhen,
        })),
    ).toEqual([
      { group: null, order: 0, visibleWhen: null },
      {
        group: 'Advanced',
        order: 7,
        visibleWhen: { setting: 'acme.form.on', equals: true },
      },
    ]);
  });

  it('contributesOf перечисляет id настроек и имена событий', () => {
    expect(contributesOf(stateful('acme.s'))).toMatchObject({
      settings: ['acme.s.greeting', 'acme.s.limit', 'acme.s.tags'],
      events: ['attempt.closed', 'session.started'],
    });
  });
});

describe('протокол хоста принимает новые ключи точек', () => {
  const replace = (extension: Record<string, unknown>) => ({
    id: '1',
    method: 'replaceExtensions',
    params: { extensions: [extension] },
  });

  it('replaceExtensions с settings и events не отвергается (иначе все расширения исчезли бы)', () => {
    expect(
      extMessageSchema.safeParse(replace({ ...stateful('acme.s') })).success,
    ).toBe(true);
  });

  it.each(['settings', 'events'])(
    'набор без ключа %s отвергается целиком',
    (key) => {
      const rest = Object.fromEntries(
        Object.entries(stateful('acme.s')).filter(([name]) => name !== key),
      );
      expect(extMessageSchema.safeParse(replace(rest)).success).toBe(false);
    },
  );
});
