import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDiagnostic } from '../src/diagnostics.ts';
import { discoverExtensions } from '../src/discover.ts';
import { parseManifest } from '../src/manifest.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { extMessageSchema } from '../src/protocol.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger, holderOf } from './helpers.ts';

const ID = 'acme.sched';

const manifest = (
  contributes: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({ id: ID, version: '1.0.0', apiVersion: 1, contributes, ...extra });

const daily = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.morning`,
  every: 'daily',
  ...patch,
});
const hourly = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.tick`,
  every: 'hourly',
  ...patch,
});

const messageOf = (raw: unknown): string => {
  const parsed = parseManifest(raw);
  if (parsed.ok) throw new Error('manifest was accepted');
  return formatDiagnostic(parsed.diagnostic);
};

describe('точка schedules', () => {
  it('daily получает 09:00 по умолчанию, hourly времени не имеет; расписания требуют код: main подставляется', () => {
    const parsed = parseManifest(
      manifest({
        schedules: [
          daily(),
          daily({ id: `${ID}.evening`, at: '21:30' }),
          hourly(),
        ],
      }),
    );
    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(parsed.manifest.main).toBe('./main.mjs');
    expect(parsed.manifest.contributes.schedules).toEqual([
      { id: `${ID}.morning`, every: 'daily', at: '09:00' },
      { id: `${ID}.evening`, every: 'daily', at: '21:30' },
      { id: `${ID}.tick`, every: 'hourly' },
    ]);
  });

  it.each([
    ['00:00', true],
    ['23:59', true],
    ['9:00', false],
    ['24:00', false],
    ['12:60', false],
    ['12:5', false],
    ['noon', false],
    ['', false],
  ])('at %j: допустимо = %s', (at, ok) => {
    expect(parseManifest(manifest({ schedules: [daily({ at })] })).ok).toBe(ok);
  });

  it.each([
    ['hourly с at', hourly({ at: '10:00' }), 'at'],
    ['неизвестный every', daily({ every: 'weekly' }), 'every'],
    ['нет every', daily({ every: undefined }), 'every'],
    [
      'id вне пространства расширения',
      daily({ id: 'other.morning' }),
      "id must be 'acme.sched'",
    ],
    ['лишний ключ', daily({ title: 'Morning' }), 'title'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(manifest({ schedules: [entry] }))).toContain(fragment);
  });

  it('отклоняет повтор id и более 4 расписаний', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        daily({ id: `${ID}.s${index}` }),
      );
    expect(messageOf(manifest({ schedules: [daily(), daily()] }))).toContain(
      `contributes.schedules.1.id: duplicate id '${ID}.morning'`,
    );
    expect(parseManifest(manifest({ schedules: many(4) })).ok).toBe(true);
    expect(messageOf(manifest({ schedules: many(5) }))).toContain(
      'at most 4 schedules',
    );
  });
});

describe('обнаружение и реестр расписаний', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dolphy-schedules-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const found = async () => {
    await mkdir(path.join(root, ID), { recursive: true });
    await writeFile(
      path.join(root, ID, 'extension.json'),
      JSON.stringify(
        manifest({ schedules: [daily({ at: '07:15' }), hourly()] }),
      ),
    );
    await writeFile(path.join(root, ID, 'main.mjs'), 'export default {};');
    return holderOf(
      (
        await discoverExtensions({
          roots: [{ dir: root, origin: 'user' }],
          logger: createLogger(),
        })
      ).extensions,
    );
  };

  const settings = (patch: Record<string, string[]> = {}) => ({
    disabled: [],
    trusted: [],
    checkUpdates: true,
    safeMode: false,
    notificationsOff: [],
    schedulesOff: [],
    ...patch,
  });

  it('расписания включённого расширения попадают во вклады и в список с id; at у hourly — null', async () => {
    const holder = await found();
    const policy = createExtensionPolicy(holder);
    policy.update(settings());

    const registry = createExtensionRegistry(holder, policy);

    expect(registry.contributions().schedules).toEqual([
      { id: `${ID}.morning`, extensionId: ID, every: 'daily', at: '07:15' },
      { id: `${ID}.tick`, extensionId: ID, every: 'hourly', at: null },
    ]);
    expect(registry.list()[0]?.contributes.schedules).toEqual([
      `${ID}.morning`,
      `${ID}.tick`,
    ]);
  });

  it('отключённое расширение расписаний во вкладах не даёт', async () => {
    const holder = await found();
    const policy = createExtensionPolicy(holder);
    policy.update(settings({ disabled: [ID] }));

    expect(
      createExtensionRegistry(holder, policy).contributions().schedules,
    ).toEqual([]);
  });

  it('переключатель «Расписание» не убирает вклады, но policy.areSchedulesOn его отражает', async () => {
    const holder = await found();
    const policy = createExtensionPolicy(holder);
    expect(policy.areSchedulesOn(ID)).toBe(true);
    policy.update(settings({ schedulesOff: [ID] }));

    expect(policy.areSchedulesOn(ID)).toBe(false);
    expect(policy.areSchedulesOn('acme.other')).toBe(true);
    expect(policy.isEnabled(ID)).toBe(true);
    expect(
      createExtensionRegistry(holder, policy).contributions().schedules,
    ).toHaveLength(2);
  });
});

describe('протокол fireSchedule', () => {
  const params = { extensionId: ID, scheduleId: `${ID}.tick`, isolated: false };

  it('принимает запрос расписания и отвергает лишние поля', () => {
    expect(
      extMessageSchema.safeParse({ id: '1', method: 'fireSchedule', params })
        .success,
    ).toBe(true);
    expect(
      extMessageSchema.safeParse({
        id: '1',
        method: 'fireSchedule',
        params: { ...params, at: 1 },
      }).success,
    ).toBe(false);
    expect(
      extMessageSchema.safeParse({
        id: '1',
        method: 'fireSchedule',
        params: { extensionId: ID, isolated: false },
      }).success,
    ).toBe(false);
  });
});
