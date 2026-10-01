import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExtensionInstaller } from '../src/index.ts';
import type { ExtensionInstaller } from '@dolphy-app/engine/ports';
import {
  contributesOf,
  createClock,
  createLogger,
  inspectJson,
  sha256,
} from './helpers.ts';

/** Настоящие HTTP-серверы на 127.0.0.1: каталог и «чужой» сервер на другом порту. */
interface Running {
  server: Server;
  origin: string;
}

const listen = (
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Running> =>
  new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });

const close = (running: Running): Promise<void> =>
  new Promise((resolve) => {
    running.server.closeAllConnections();
    running.server.close(() => resolve());
  });

const extensionJson = (id: string): string =>
  JSON.stringify({
    id,
    version: '1.0.0',
    permissions: [],
    contributes: contributesOf([id]),
  });

const mainSource = (id: string): string =>
  `export default { activate() { return '${id}'; } };\n`;

let work: string;
let catalog: Running;
let foreign: Running;
let installer: ExtensionInstaller;
let extensionsDir: string;
const requests: string[] = [];
const foreignRequests: string[] = [];
let notModified = 0;

const files = (id: string): Record<string, string> => ({
  'extension.json': extensionJson(id),
  'main.mjs': mainSource(id),
});

const entry = (id: string) => ({
  id,
  name: id,
  description: `Description of ${id}`,
  author: 'octo-cat',
  source: 'https://github.com/dolphy-app/dolphy-extensions',
  platforms: [],
  contributes: contributesOf([id]),
  versions: [
    {
      version: '1.0.0',
      apiVersion: 1,
      minAppVersion: null,
      permissions: [],
      publishedAt: '2026-10-01T00:00:00Z',
      baseUrl: `extensions/${id}/1.0.0/`,
      files: Object.entries(files(id)).map(([filePath, content]) => ({
        path: filePath,
        size: Buffer.byteLength(content),
        sha256: sha256(content),
      })),
    },
  ],
});

const INDEX = JSON.stringify({
  schemaVersion: 1,
  generatedAt: '2026-10-01T12:00:00Z',
  extensions: ['acme.real', 'acme.bounce', 'acme.moved'].map(entry),
  revoked: [],
});
const INDEX_ETAG = `"${sha256(INDEX).slice(0, 12)}"`;

const catalogHandler = (req: IncomingMessage, res: ServerResponse): void => {
  const url = req.url ?? '/';
  requests.push(`${req.method} ${url} ua=${req.headers['user-agent']}`);
  if (url === '/index.json') {
    if (req.headers['if-none-match'] === INDEX_ETAG) {
      notModified++;
      res.writeHead(304, { etag: INDEX_ETAG }).end();
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json', etag: INDEX_ETAG })
      .end(INDEX);
    return;
  }
  const match = /^\/extensions\/([^/]+)\/1\.0\.0\/([^/]+)$/.exec(url);
  const id = match?.[1];
  const name = match?.[2];
  const content = id === undefined ? undefined : files(id)[name ?? ''];
  if (id === undefined || name === undefined || content === undefined) {
    res.writeHead(404).end('not found');
  } else if (id === 'acme.bounce' && name === 'main.mjs') {
    res
      .writeHead(302, { location: `${foreign.origin}/payload/main.mjs` })
      .end();
  } else if (id === 'acme.moved' && name === 'main.mjs') {
    res.writeHead(307, { location: '/mirror/acme.moved/main.mjs' }).end();
  } else {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(content);
  }
};

beforeEach(async () => {
  requests.length = 0;
  foreignRequests.length = 0;
  notModified = 0;
  work = await mkdtemp(path.join(tmpdir(), 'dolphy-http-'));
  extensionsDir = path.join(work, 'extensions');
  await mkdir(extensionsDir);
  foreign = await listen((req, res) => {
    foreignRequests.push(req.url ?? '');
    res.writeHead(200).end(mainSource('acme.bounce'));
  });
  catalog = await listen((req, res) => {
    if (req.url?.startsWith('/mirror/acme.moved/') === true) {
      requests.push(`GET ${req.url} (mirror)`);
      res.writeHead(200).end(mainSource('acme.moved'));
      return;
    }
    catalogHandler(req, res);
  });
  installer = createExtensionInstaller({
    catalogUrl: `${catalog.origin}/index.json`,
    extensionsDir,
    bundledIds: () => new Set(),
    appVersion: '1.2.3',
    apiVersion: 1,
    platform: 'darwin',
    inspectDir: inspectJson,
    logger: createLogger(),
    now: createClock().now,
  });
});

afterEach(async () => {
  await close(catalog);
  await close(foreign);
  await rm(work, { recursive: true, force: true });
});

describe('установщик с настоящим HTTP-сервером', () => {
  it('каталог → установка: файлы на диске побайтно равны опубликованным', async () => {
    const listing = await installer.catalog();
    expect(listing.entries.map((e) => [e.id, e.status])).toEqual([
      ['acme.bounce', 'available'],
      ['acme.moved', 'available'],
      ['acme.real', 'available'],
    ]);
    const result = await installer.install('acme.real');
    expect(result).toEqual({
      id: 'acme.real',
      version: '1.0.0',
      previousVersion: null,
    });
    for (const [name, content] of Object.entries(files('acme.real'))) {
      const onDisk = await readFile(
        path.join(extensionsDir, 'acme.real', name),
      );
      expect(sha256(onDisk)).toBe(sha256(content));
    }
    expect(requests.every((line) => line.endsWith('ua=dolphy/1.2.3'))).toBe(
      true,
    );
    expect(
      (await installer.catalog()).entries.find((e) => e.id === 'acme.real')
        ?.status,
    ).toBe('installed');
  });

  it('повторный запрос индекса отвечает 304 по ETag', async () => {
    await installer.catalog();
    const again = await installer.catalog({ refresh: true });
    expect(again.stale).toBe(false);
    expect(notModified).toBe(1);
    expect(
      requests.filter((r) => r.startsWith('GET /index.json')),
    ).toHaveLength(2);
  });

  it('редирект на другой порт отклонён: на чужой сервер запрос не уходит', async () => {
    await expect(installer.install('acme.bounce')).rejects.toMatchObject({
      cause: 'network',
    });
    expect(foreignRequests).toEqual([]);
    await expect(
      readFile(path.join(extensionsDir, 'acme.bounce', 'main.mjs')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('редирект в пределах origin выполняется', async () => {
    await expect(installer.install('acme.moved')).resolves.toMatchObject({
      version: '1.0.0',
    });
    expect(
      await readFile(
        path.join(extensionsDir, 'acme.moved', 'main.mjs'),
        'utf8',
      ),
    ).toBe(mainSource('acme.moved'));
  });

  it('файл с подменённым содержимым отвергается по sha256', async () => {
    await close(catalog);
    catalog = await listen((req, res) => {
      if (req.url?.endsWith('/main.mjs') === true) {
        res.writeHead(200).end(mainSource('acme.real').replace('real', 'evil'));
        return;
      }
      catalogHandler(req, res);
    });
    const tampered = createExtensionInstaller({
      catalogUrl: `${catalog.origin}/index.json`,
      extensionsDir,
      bundledIds: () => new Set(),
      appVersion: '1.2.3',
      apiVersion: 1,
      platform: 'darwin',
      inspectDir: inspectJson,
      logger: createLogger(),
    });
    await expect(tampered.install('acme.real')).rejects.toMatchObject({
      cause: 'integrity',
    });
  });
});
