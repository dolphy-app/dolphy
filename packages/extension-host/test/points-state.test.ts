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
      { id: `${ID}.x`, type: 'color', label: 'X', default: '#fff' },
      'type',
    ],
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

  it('отклоняет повтор id внутри манифеста', () => {
    expect(
      messageOf(
        manifest({ settings: [setting(), setting({ label: 'Again' })] }),
      ),
    ).toContain("contributes.settings.1.id: duplicate id 'acme.pt.volume'");
  });
});

describe('точка events и разрешение learning.events', () => {
  it('события требуют разрешения learning.events', () => {
    const contributes = { events: [{ event: 'attempt.closed' }] };

    expect(messageOf(manifest(contributes))).toBe(
      "permissions: contributes.events requires the 'learning.events' permission",
    );
    expect(
      messageOf(manifest(contributes, { permissions: ['library.read'] })),
    ).toContain("'learning.events' permission");
  });

  it('с разрешением принимает три события и подставляет main (событиям нужен код)', () => {
    const parsed = parseManifest(
      manifest(
        {
          events: [
            { event: 'session.started' },
            { event: 'session.finished' },
            { event: 'attempt.closed' },
          ],
        },
        { permissions: ['learning.events'] },
      ),
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
    expect(
      messageOf(manifest({ events }, { permissions: ['learning.events'] })),
    ).toContain(fragment);
  });

  it('разрешение без событий допустимо', () => {
    expect(
      parseManifest(
        manifest(
          { settings: [setting()] },
          { permissions: ['learning.events'] },
        ),
      ).ok,
    ).toBe(true);
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
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });

    expect(registry.contributions().settings).toEqual([
      {
        extensionId: 'acme.a',
        id: 'acme.a',
        type: 'number',
        label: 'Volume',
        description: 'How loud',
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

  it('contributesOf перечисляет id настроек и имена событий', () => {
    expect(contributesOf(stateful('acme.s'))).toMatchObject({
      settings: ['acme.s.greeting', 'acme.s.limit'],
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
