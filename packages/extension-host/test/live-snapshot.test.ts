import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import { discoverExtensions } from '../src/discover.ts';
import type { ExtensionOrigin, ResolvedExtension } from '../src/discover.ts';
import { fingerprintDir } from '../src/fingerprint.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger } from './helpers.ts';

const extension = (
  id: string,
  origin: ExtensionOrigin,
  overrides: Partial<ResolvedExtension> = {},
): ResolvedExtension => ({
  id,
  version: '1.0.0',
  origin,
  revision: '',
  dir: `/x/${id}`,
  mainPath: null,
  permissions: [],
  name: null,
  description: null,
  author: null,
  platforms: [],
  minAppVersion: null,
  icon: null,
  tags: [],
  install: null,
  messages: {},
  warnings: [],
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  panels: [],
  widgets: [],
  ...overrides,
});

const withType = (id: string, type: string): ResolvedExtension =>
  extension(id, 'user', {
    exerciseTypes: [
      {
        id: type,
        title: null,
        specSchema: {},
        answerSchema: {},
        element: `${type.replaceAll('.', '-')}-answer`,
        rendererUrl: `dolphy-ext://${id}/view.mjs`,
      },
    ],
    themes: [
      {
        id: `${id}.theme`,
        label: 'Theme',
        dark: false,
        colors: { background: '#fff' },
        variables: {},
      },
    ],
  });

describe('политика, каталог и реестр читают снимок при каждом вызове', () => {
  it('replace виден всем трём без пересоздания', () => {
    const holder = createDiscoveryHolder(
      discoveryOf([withType('acme.a', 'acme.a')]),
    );
    const policy = createExtensionPolicy(holder);
    const catalog = createCatalog(holder, policy);
    const registry = createExtensionRegistry(holder, policy);

    expect(catalog.list().map(({ type }) => type)).toEqual(['acme.a']);
    expect(registry.list().map(({ id }) => id)).toEqual(['acme.a']);
    expect(registry.contributions().themes.map(({ id }) => id)).toEqual([
      'acme.a.theme',
    ]);

    holder.replace(
      discoveryOf([
        withType('acme.b', 'acme.b'),
        extension('dolphy.sql', 'bundled'),
      ]),
    );

    expect(catalog.list().map(({ type }) => type)).toEqual(['acme.b']);
    expect(catalog.describe('acme.a')).toBeUndefined();
    expect(catalog.ownerOf('acme.b')?.id).toBe('acme.b');
    expect(registry.list().map(({ id }) => id)).toEqual([
      'acme.b',
      'dolphy.sql',
    ]);
    expect(registry.contributions().themes.map(({ id }) => id)).toEqual([
      'acme.b.theme',
    ]);
    // происхождение берётся из нового снимка: расширение из поставки не изолируется
    expect(policy.isIsolated('dolphy.sql')).toBe(false);
    expect(policy.isIsolated('acme.a')).toBe(true);
  });

  it('настройки пользователя переживают замену снимка', () => {
    const holder = createDiscoveryHolder(
      discoveryOf([withType('acme.a', 'acme.a')]),
    );
    const policy = createExtensionPolicy(holder);
    const catalog = createCatalog(holder, policy);
    policy.update({
      disabled: ['acme.a'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
    expect(catalog.list()).toEqual([]);
    holder.replace(discoveryOf([withType('acme.a', 'acme.a')]));
    expect(catalog.list()).toEqual([]); // всё ещё отключено
    policy.update({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
    expect(catalog.list().map(({ type }) => type)).toEqual(['acme.a']);
  });

  it('перекрытые и некорректные записи реестра берутся из нового снимка', () => {
    const holder = createDiscoveryHolder(discoveryOf([]));
    const registry = createExtensionRegistry(
      holder,
      createExtensionPolicy(holder),
    );
    expect(registry.list()).toEqual([]);
    holder.replace({
      extensions: [],
      diagnostics: [
        {
          extensionId: 'acme.broken',
          origin: 'user',
          diagnostic: { code: 'manifest-invalid', data: { issues: ['bad'] } },
        },
      ],
      overridden: [],
    });
    expect(registry.list()).toMatchObject([
      {
        id: 'acme.broken',
        state: 'invalid',
        diagnostics: [{ code: 'manifest-invalid', data: { issues: ['bad'] } }],
      },
    ]);
  });
});

describe('отпечаток каталога расширения (revision)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dolphy-fingerprint-'));
    await mkdir(join(root, 'acme.fp'));
    await writeFile(
      join(root, 'acme.fp', 'extension.json'),
      JSON.stringify({
        id: 'acme.fp',
        version: '1.0.0',
        apiVersion: 1,
        contributes: {
          exerciseTypes: [
            {
              id: 'acme.fp',
              specSchema: { type: 'object' },
              answerSchema: { type: 'string' },
              renderer: './main.mjs',
            },
          ],
        },
      }),
    );
    await writeFile(join(root, 'acme.fp', 'main.mjs'), 'export default 1;\n');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const dir = () => join(root, 'acme.fp');

  it('не меняется, пока файлы те же, и меняется от правки любого файла', async () => {
    const before = await fingerprintDir(dir());
    expect(await fingerprintDir(dir())).toBe(before);
    await writeFile(join(dir(), 'main.mjs'), 'export default 22;\n');
    const edited = await fingerprintDir(dir());
    expect(edited).not.toBe(before);
    const stamp = new Date(Date.now() + 5000);
    await utimes(join(dir(), 'main.mjs'), stamp, stamp); // тот же размер, другое время
    expect(await fingerprintDir(dir())).not.toBe(edited);
  });

  it('служебные файлы, скрытые каталоги и node_modules не считаются правкой', async () => {
    const before = await fingerprintDir(dir());
    await writeFile(join(dir(), '.DS_Store'), 'x');
    await mkdir(join(dir(), 'node_modules', 'dep'), { recursive: true });
    await writeFile(join(dir(), 'node_modules', 'dep', 'index.js'), 'x');
    await mkdir(join(dir(), '.git'));
    await writeFile(join(dir(), '.git', 'HEAD'), 'x');
    expect(await fingerprintDir(dir())).toBe(before);
  });

  it('обнаружение кладёт отпечаток в расширения из пользовательского каталога и каталога разработчика, но не из поставки', async () => {
    const found = async (origin: ExtensionOrigin) =>
      (
        await discoverExtensions({
          roots: [{ dir: root, origin }],
          logger: createLogger(),
        })
      ).extensions[0]?.revision;
    expect(await found('user')).toBe(await fingerprintDir(dir()));
    expect(await found('dev')).toBe(await fingerprintDir(dir()));
    expect(await found('bundled')).toBe('');
  });
});
