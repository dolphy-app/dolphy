import {
  mkdir,
  readdir,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_URL,
  createEnv,
  installFake,
  readText,
  serveIndex,
} from './helpers.ts';
import type { Env } from './helpers.ts';

let env: Env;
beforeEach(async () => {
  env = await createEnv();
});
afterEach(() => env.cleanup());

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

const exists = (...parts: string[]): Promise<boolean> =>
  stat(path.join(...parts)).then(
    () => true,
    () => false,
  );

describe('uninstall', () => {
  it('переносит каталог в .trash и удаляет его', async () => {
    await installFake(env.dir, 'acme.echo', '1.0.0');
    await env.installer.uninstall('acme.echo');
    expect(await exists(env.dir, 'acme.echo')).toBe(false);
    expect(await readdir(path.join(env.dir, '.trash', 'removed'))).toEqual([]);
  });

  it('удаляет и скопированное вручную расширение', async () => {
    await mkdir(path.join(env.dir, 'manual.ext'));
    await env.installer.uninstall('manual.ext');
    expect(await exists(env.dir, 'manual.ext')).toBe(false);
  });

  it('нет каталога или это файл: not-found', async () => {
    await writeFile(path.join(env.dir, 'plain.file'), 'x');
    expect(await rejection(env.installer.uninstall('acme.none'))).toMatchObject(
      {
        cause: 'not-found',
      },
    );
    expect(
      await rejection(env.installer.uninstall('plain.file')),
    ).toMatchObject({
      cause: 'not-found',
    });
    expect(await exists(env.dir, 'plain.file')).toBe(true);
  });

  it.each(['../outside', 'a/b', '..', '.staging', '.catalog', '', 'Acme.Echo'])(
    'id «%s» отклонён, ничего не удалено',
    async (id) => {
      const outside = path.join(env.dir, '..', 'outside');
      await mkdir(outside, { recursive: true });
      await mkdir(path.join(env.dir, '.staging'), { recursive: true });
      await mkdir(path.join(env.dir, '.catalog'), { recursive: true });
      expect(await rejection(env.installer.uninstall(id))).toMatchObject({
        cause: 'not-found',
      });
      expect(await exists(outside)).toBe(true);
      expect(await exists(env.dir, '.staging')).toBe(true);
      expect(await exists(env.dir, '.catalog')).toBe(true);
    },
  );

  it('символическая ссылка не удаляется и не разыменовывается', async () => {
    const target = path.join(tmpdir(), `dolphy-link-target-${Date.now()}`);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'keep.txt'), 'keep');
    await symlink(target, path.join(env.dir, 'linked.ext'), 'dir');
    expect(
      await rejection(env.installer.uninstall('linked.ext')),
    ).toMatchObject({
      cause: 'invalid',
    });
    expect(await readText(target, 'keep.txt')).toBe('keep');
    expect(await exists(env.dir, 'linked.ext')).toBe(true);
  });
});

describe('ready: уборка', () => {
  it('очищает .trash и старый стейджинг, свежий не трогает', async () => {
    await mkdir(path.join(env.dir, '.trash', 'old-1'), { recursive: true });
    await writeFile(path.join(env.dir, '.trash', 'old-1', 'a.txt'), 'x');
    const stale = path.join(env.dir, '.staging', 'stale-abc');
    const fresh = path.join(env.dir, '.staging', 'fresh-abc');
    await mkdir(stale, { recursive: true });
    await mkdir(fresh, { recursive: true });
    const hourAgo = new Date(env.clock.now() - 2 * 60 * 60_000);
    await utimes(stale, hourAgo, hourAgo);
    const now = new Date(env.clock.now());
    await utimes(fresh, now, now);
    await env.installer.ready();
    expect(await exists(env.dir, '.trash')).toBe(false);
    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
  });

  describe('восстановление прерванной замены', () => {
    const trashEntry = async (
      name: string,
      files: Record<string, string> = {
        'extension.json': '{}',
        'main.mjs': 'old',
      },
    ): Promise<string> => {
      const dir = path.join(env.dir, '.trash', name);
      await mkdir(dir, { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        await writeFile(path.join(dir, file), content);
      }
      return dir;
    };

    it('процесс убит между rename: каталог возвращается из .trash', async () => {
      await trashEntry('acme.echo-1000', {
        'extension.json': '{}',
        'main.mjs': 'previous',
        '.dolphy-install.json': JSON.stringify({
          catalogUrl: CATALOG_URL,
          version: '1.0.0',
          installedAt: '2026-09-01T00:00:00.000Z',
        }),
      });
      await env.installer.ready();
      expect(await readText(env.dir, 'acme.echo', 'main.mjs')).toBe('previous');
      expect(await exists(env.dir, '.trash')).toBe(false);
      expect(env.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ extensionId: 'acme.echo' }),
        'restored interrupted install',
      );
    });

    it('каталог расширения на месте: запись .trash удаляется', async () => {
      await installFake(env.dir, 'acme.echo', '2.0.0');
      await trashEntry('acme.echo-1000');
      await env.installer.ready();
      expect(await readText(env.dir, 'acme.echo', 'main.mjs')).toBe(
        "export default '2.0.0';",
      );
      expect(await exists(env.dir, '.trash')).toBe(false);
    });

    it('удалённое через uninstall не воскресает', async () => {
      await installFake(env.dir, 'acme.echo', '1.0.0');
      await env.installer.uninstall('acme.echo');
      await trashEntry('removed/acme.echo-1000-abcd');
      await env.restart().ready();
      expect(await exists(env.dir, 'acme.echo')).toBe(false);
      expect(await exists(env.dir, '.trash')).toBe(false);
    });

    it('несколько записей одного id: возвращается самая новая, остальные удаляются', async () => {
      await trashEntry('acme.echo-1000', {
        'extension.json': '{}',
        'main.mjs': 'older',
      });
      await trashEntry('acme.echo-2000', {
        'extension.json': '{}',
        'main.mjs': 'newer',
      });
      await env.installer.ready();
      expect(await readText(env.dir, 'acme.echo', 'main.mjs')).toBe('newer');
      expect(await exists(env.dir, '.trash')).toBe(false);
    });

    it('новейшая запись повреждена: возвращается следующая годная', async () => {
      await trashEntry('acme.echo-1000');
      await trashEntry('acme.echo-2000', { 'main.mjs': 'no manifest' });
      await env.installer.ready();
      expect(await readText(env.dir, 'acme.echo', 'main.mjs')).toBe('old');
    });

    it.each([
      ['нет extension.json', { 'main.mjs': 'x' }],
      [
        'sidecar не разбирается',
        { 'extension.json': '{}', '.dolphy-install.json': '{broken' },
      ],
    ])('%s: ничего не возвращается, запись удаляется', async (_name, files) => {
      await trashEntry('acme.echo-1000', files);
      await env.installer.ready();
      expect(await exists(env.dir, 'acme.echo')).toBe(false);
      expect(await exists(env.dir, '.trash')).toBe(false);
    });

    it('запись с недопустимым id не возвращается', async () => {
      await trashEntry('Bad_Name-1000');
      await env.installer.ready();
      expect(await exists(env.dir, 'Bad_Name')).toBe(false);
      expect(await exists(env.dir, '.trash')).toBe(false);
    });
  });

  it('ready идемпотентен и не падает в пустом каталоге', async () => {
    const first = env.installer.ready();
    expect(env.installer.ready()).toBe(first);
    await first;
    await env.installer.ready();
  });

  it('каталог расширений не существует: ready проходит, кэша нет', async () => {
    const missing = await createEnv();
    await missing.cleanup();
    await expect(missing.installer.ready()).resolves.toBeUndefined();
    expect(await missing.installer.updates()).toEqual([]);
  });
});

describe('updates и отзыв', () => {
  it('предлагает обновления только для установленных из каталога; несовместимая новейшая заменяется запасной', async () => {
    serveIndex(env.routes, [
      {
        id: 'a.old',
        name: 'Old',
        version: '1.2.0',
        versions: ['1.2.0', '1.0.0'],
      },
      { id: 'b.current', version: '1.0.0' },
      { id: 'c.manual', version: '2.0.0' },
      { id: 'd.other', version: '2.0.0' },
      {
        id: 'e.app',
        version: '3.0.0',
        versions: ['3.0.0', '2.0.0', '1.0.0'],
        minAppByVersion: { '3.0.0': '9.0.0' },
      },
      {
        id: 'f.nofallback',
        version: '3.0.0',
        versions: ['3.0.0', '1.0.0'],
        minAppByVersion: { '3.0.0': '9.0.0' },
      },
    ]);
    await installFake(env.dir, 'a.old', '1.0.0');
    await installFake(env.dir, 'b.current', '1.0.0');
    await mkdir(path.join(env.dir, 'c.manual'));
    await installFake(
      env.dir,
      'd.other',
      '1.0.0',
      'https://other.test/index.json',
    );
    await installFake(env.dir, 'e.app', '1.0.0');
    await installFake(env.dir, 'f.nofallback', '1.0.0');
    await env.installer.catalog();
    const updates = await env.installer.updates();
    expect(
      updates.map((u) => [u.id, u.name, u.installed, u.available.version]),
    ).toEqual([
      ['e.app', 'e.app', '1.0.0', '2.0.0'],
      ['a.old', 'Old', '1.0.0', '1.2.0'],
    ]);
  });

  it('все новые версии несовместимы: обновление не предлагается', async () => {
    serveIndex(env.routes, [
      {
        id: 'e.app',
        version: '3.0.0',
        versions: ['3.0.0', '2.0.0'],
        minAppVersion: '9.0.0',
      },
    ]);
    await installFake(env.dir, 'e.app', '1.0.0');
    await env.installer.catalog();
    expect(await env.installer.updates()).toEqual([]);
  });

  it('без индекса обновлений нет', async () => {
    await installFake(env.dir, 'a.old', '1.0.0');
    expect(await env.installer.updates()).toEqual([]);
  });

  it('revocationOf: диапазоны, границы и отсутствие индекса', async () => {
    expect(env.installer.revocationOf('acme.bad', '1.0.0')).toBeNull();
    serveIndex(env.routes, [{ id: 'acme.bad', version: '1.3.0' }], {
      revoked: [
        { id: 'acme.bad', versions: '<1.2.0', reason: 'security fix' },
        { id: 'acme.range', versions: '>=2.0.0 <2.5.0', reason: 'broken' },
      ],
    });
    await env.installer.catalog();
    expect(env.installer.revocationOf('acme.bad', '1.1.9')).toBe(
      'security fix',
    );
    expect(env.installer.revocationOf('acme.bad', '1.2.0')).toBeNull();
    expect(env.installer.revocationOf('acme.range', '2.4.9')).toBe('broken');
    expect(env.installer.revocationOf('acme.range', '2.5.0')).toBeNull();
    expect(env.installer.revocationOf('acme.other', '1.0.0')).toBeNull();
    expect(env.installer.revocationOf('acme.bad', 'not-semver')).toBeNull();
  });

  it('revocationOf работает офлайн после ready() по кэшу с диска', async () => {
    serveIndex(env.routes, [{ id: 'acme.bad', version: '1.3.0' }], {
      revoked: [{ id: 'acme.bad', versions: '<1.2.0', reason: 'security fix' }],
    });
    await env.installer.catalog();
    env.routes.set(CATALOG_URL, { fail: true });
    const restarted = env.restart();
    await restarted.ready();
    expect(restarted.revocationOf('acme.bad', '1.0.0')).toBe('security fix');
  });
});
