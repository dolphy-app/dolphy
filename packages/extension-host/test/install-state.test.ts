import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createDiscoveryHolder } from '../src/holder.ts';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INSTALL_META_FILE } from '@dolphy-app/extension-catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ExtensionRoot } from '../src/discover.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger } from './helpers.ts';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'dolphy-install-state-'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const META = {
  catalogUrl: 'https://example.test/index.json',
  version: '1.0.0',
  installedAt: '2026-10-01T10:00:00.000Z',
};

const writeExtension = async (
  root: string,
  id: string,
  sidecar?: string,
): Promise<void> => {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'extension.json'),
    JSON.stringify({
      id,
      version: '1.0.0',
      apiVersion: 1,
      name: 'Acme',
      description: 'Acme extension',
      author: 'acme',
      contributes: {
        themes: [
          {
            id: `${id}.night`,
            label: 'Night',
            dark: true,
            colors: { background: '#000000' },
          },
        ],
      },
    }),
  );
  if (sidecar !== undefined) {
    await writeFile(path.join(dir, INSTALL_META_FILE), sidecar);
  }
};

const discover = async (roots: ExtensionRoot[]) => {
  const logger = createLogger();
  const result = await discoverExtensions({ roots, logger });
  return { ...result, logger };
};

describe('discoverExtensions: .dolphy-install.json', () => {
  it('reads the sidecar of user extensions only', async () => {
    const user = path.join(tmp, 'user');
    const dev = path.join(tmp, 'dev');
    await writeExtension(user, 'acme.u', JSON.stringify(META));
    await writeExtension(dev, 'acme.d', JSON.stringify(META));
    const { extensions } = await discover([
      { dir: user, origin: 'user' },
      { dir: dev, origin: 'dev' },
    ]);
    const byId = Object.fromEntries(extensions.map((e) => [e.id, e.install]));
    expect(byId).toEqual({ 'acme.u': META, 'acme.d': null });
  });

  it.each([
    ['is absent', undefined],
    ['is not JSON', '{ nope'],
    ['has the wrong shape', JSON.stringify({ version: 1 })],
  ])(
    'a sidecar that %s gives install: null and never fails discovery',
    async (_, sidecar) => {
      const user = path.join(tmp, 'user');
      await writeExtension(user, 'acme.u', sidecar);
      const { extensions, diagnostics, logger } = await discover([
        { dir: user, origin: 'user' },
      ]);
      expect(diagnostics).toEqual([]);
      expect(extensions.map(({ id, install }) => [id, install])).toEqual([
        ['acme.u', null],
      ]);
      // отсутствие файла — норма, битый файл — предупреждение
      expect(logger.warn).toHaveBeenCalledTimes(sidecar === undefined ? 0 : 1);
    },
  );
});

describe('registry and policy: metadata and revocation', () => {
  const setup = async (revocations: Record<string, string> = {}) => {
    const user = path.join(tmp, 'user');
    const bundled = path.join(tmp, 'bundled');
    await writeExtension(user, 'acme.u', JSON.stringify(META));
    await writeExtension(user, 'acme.manual');
    await writeExtension(bundled, 'dolphy.b');
    const discovery = await discover([
      { dir: bundled, origin: 'bundled' },
      { dir: user, origin: 'user' },
    ]);
    const holder = createDiscoveryHolder(discovery);
    const revocationOf = (id: string) => revocations[id] ?? null;
    const policy = createExtensionPolicy(holder, revocationOf);
    const registry = createExtensionRegistry(holder, policy, revocationOf);
    const info = (id: string) => registry.list().find((item) => item.id === id);
    return { policy, registry, info, revocations };
  };

  it('fills manifest metadata, installed and removable', async () => {
    const { info } = await setup();
    expect(info('acme.u')).toMatchObject({
      name: 'Acme',
      description: 'Acme extension',
      author: 'acme',
      installed: META,
      removable: true,
      revoked: null,
      state: 'loaded',
    });
    expect(info('acme.manual')).toMatchObject({
      installed: null,
      removable: true,
    });
    expect(info('dolphy.b')).toMatchObject({ removable: false });
  });

  it('a revoked installed extension is disabled, not toggleable, and hidden from contributions', async () => {
    const { info, policy, registry } = await setup({ 'acme.u': 'leaks data' });
    expect(info('acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [],
      toggleable: false,
      revoked: 'leaks data',
    });
    expect(policy.isEnabled('acme.u')).toBe(false);
    // настройки пользователя отзыв не отменяют
    policy.update({ disabled: [], trusted: [], checkUpdates: true });
    expect(policy.isEnabled('acme.u')).toBe(false);
    expect(registry.contributions().themes.map(({ id }) => id)).toEqual([
      'dolphy.b.night',
      'acme.manual.night',
    ]);
  });

  it('revocation follows the lookup at call time: a fresh index re-enables', async () => {
    const { info, policy, revocations } = await setup({ 'acme.u': 'bad' });
    expect(policy.isEnabled('acme.u')).toBe(false);
    delete revocations['acme.u'];
    expect(policy.isEnabled('acme.u')).toBe(true);
    expect(info('acme.u')).toMatchObject({ state: 'loaded', revoked: null });
  });

  it('does not touch extensions copied by hand or shipped with the app', async () => {
    const { info, policy } = await setup({
      'acme.manual': 'bad',
      'dolphy.b': 'bad',
    });
    expect(policy.isEnabled('acme.manual')).toBe(true);
    expect(policy.isEnabled('dolphy.b')).toBe(true);
    expect(info('acme.manual')?.revoked).toBeNull();
    expect(info('dolphy.b')?.revoked).toBeNull();
  });
});
