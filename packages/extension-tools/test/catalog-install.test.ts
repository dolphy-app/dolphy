import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectExtensionDir } from '@dolphy-app/extension-host';
import { createExtensionInstaller } from '@dolphy-app/extension-install';
import type { InspectResult } from '@dolphy-app/extension-install';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog } from '../src/catalog/build.ts';
import { createRepo } from './catalog-helpers.ts';
import { makeTemp } from './helpers.ts';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

const serve = async (root: string): Promise<string> => {
  const server = createServer((request, response) => {
    const relative = decodeURIComponent((request.url ?? '/').slice(1));
    readFile(path.join(root, relative))
      .then((content) => response.writeHead(200).end(content))
      .catch(() => response.writeHead(404).end());
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const inspectDir = async (directory: string): Promise<InspectResult> => {
  const result = await inspectExtensionDir(directory, { expectedId: null });
  if (!result.ok) return result;
  const { extension } = result;
  return {
    ok: true,
    manifest: {
      id: extension.id,
      version: extension.version,
      permissions: extension.permissions,
      icon: extension.icon,
      contributes: {
        exerciseTypes: extension.exerciseTypes.map((type) => type.id),
        themes: extension.themes.map((theme) => theme.id),
        markdownRenderers: extension.markdownRenderers.map(
          (renderer) => renderer.language,
        ),
        gradePolicies: extension.gradePolicies.map((policy) => policy.id),
        settings: extension.settings.map((setting) => setting.id),
        events: extension.events.map((item) => item.event),
        commands: extension.commands.map(({ id }) => id),
        panels: extension.panels.map(({ id }) => id),
      },
    },
  };
};

describe('catalog site and the real installer', () => {
  it.each([
    ['acme.night', 'theme-only'],
    ['acme.hello', 'hello'],
    ['acme.chart', 'markdown-only'],
    ['acme.commands-panel', 'commands-panel'],
  ] as const)(
    'extension %s from the built site installs and passes the catalog check',
    async (id, fixture) => {
      const repo = await createRepo([{ fixture }]);
      const site = await makeTemp();
      await buildCatalog({ src: repo.extensionsDir, ids: [id], out: site });
      const origin = await serve(site);
      const extensionsDir = path.join(await makeTemp(), 'extensions');
      await mkdir(extensionsDir);
      const installer = createExtensionInstaller({
        catalogUrl: `${origin}/index.json`,
        extensionsDir,
        bundledIds: () => new Set(),
        appVersion: '1.0.0',
        apiVersion: 1,
        platform: process.platform,
        inspectDir,
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      const listing = await installer.catalog();
      expect(listing.entries.map((entry) => [entry.id, entry.status])).toEqual([
        [id, 'available'],
      ]);
      await expect(installer.install(id)).resolves.toMatchObject({
        id,
        version: '1.0.0',
      });

      const published = path.join(site, 'extensions', id, '1.0.0');
      for (const name of ['extension.json', 'README.md']) {
        expect(await readFile(path.join(extensionsDir, id, name))).toEqual(
          await readFile(path.join(published, name)),
        );
      }
      expect(
        (await installer.catalog()).entries.find((entry) => entry.id === id)
          ?.status,
      ).toBe('installed');
    },
  );
});
