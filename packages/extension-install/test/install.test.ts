import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../src/index.ts';
import {
  contributesOf,
  createEnv,
  filesOf,
  installFake,
  readText,
  serve,
  serveIndex,
  urlOf,
} from './helpers.ts';
import type { Env, ExtensionSpec } from './helpers.ts';

const ECHO: ExtensionSpec = {
  id: 'acme.echo',
  version: '1.1.0',
  versions: ['1.1.0', '1.0.0'],
};

let env: Env;
beforeEach(async () => {
  env = await createEnv();
});
afterEach(() => env.cleanup());

const publish = (spec: ExtensionSpec = ECHO): void => {
  serveIndex(env.routes, [spec]);
  for (const version of spec.versions ?? [spec.version]) {
    serve(env.routes, spec, version);
  }
};

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

const entriesOf = async (dir: string): Promise<string[]> =>
  (await readdir(dir).catch(() => [])).sort();

describe('install', () => {
  it('ставит новейшую версию: файлы, sidecar, результат', async () => {
    publish();
    const result = await env.installer.install('acme.echo');
    expect(result).toEqual({
      id: 'acme.echo',
      version: '1.1.0',
      previousVersion: null,
      restartRequired: true,
    });
    for (const file of filesOf(ECHO, '1.1.0')) {
      expect(await readText(env.dir, 'acme.echo', file.path)).toBe(
        file.content,
      );
    }
    const meta = JSON.parse(
      await readText(env.dir, 'acme.echo', '.spirula-install.json'),
    ) as Record<string, string>;
    expect(meta).toEqual({
      catalogUrl: 'https://catalog.test/index.json',
      version: '1.1.0',
      installedAt: new Date(env.clock.now()).toISOString(),
    });
    expect(await entriesOf(path.join(env.dir, '.staging'))).toEqual([]);
    expect(await entriesOf(path.join(env.dir, '.trash'))).toEqual([]);
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry).toMatchObject({
      status: 'installed',
      installedVersion: '1.1.0',
    });
  });

  it('файлы запрашиваются с User-Agent и без автоматических редиректов', async () => {
    publish();
    await env.installer.install('acme.echo');
    const fileCalls = env.fake.calls.filter((c) =>
      c.url.includes('/extensions/'),
    );
    expect(fileCalls.length).toBeGreaterThan(0);
    for (const call of fileCalls) {
      expect(call.headers['User-Agent']).toBe('spirula/1.0.0');
      expect(call.redirect).toBe('manual');
    }
  });

  it('обновление: прежняя версия в результате, каталог заменён, .trash пуст', async () => {
    publish();
    await env.installer.install('acme.echo', '1.0.0');
    const result = await env.installer.install('acme.echo');
    expect(result).toMatchObject({
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
    expect(await readText(env.dir, 'acme.echo', 'main.mjs')).toBe(
      "export default '1.1.0';",
    );
    expect(await entriesOf(path.join(env.dir, '.trash'))).toEqual([]);
  });

  it('явная старая версия ставится, если совместима', async () => {
    publish();
    const result = await env.installer.install('acme.echo', '1.0.0');
    expect(result.version).toBe('1.0.0');
  });

  it('работает без предварительного catalog(): индекс запрашивается сам', async () => {
    publish();
    const fresh = env.restart();
    expect((await fresh.install('acme.echo')).version).toBe('1.1.0');
  });
});

describe('install: отказы до скачивания', () => {
  it('нет записи в каталоге: not-found', async () => {
    publish();
    expect(await rejection(env.installer.install('acme.none'))).toMatchObject({
      cause: 'not-found',
    });
    expect(await rejection(env.installer.install('../etc'))).toMatchObject({
      cause: 'not-found',
    });
  });

  it('версии нет в записи: incompatible', async () => {
    publish();
    expect(
      await rejection(env.installer.install('acme.echo', '9.9.9')),
    ).toMatchObject({
      cause: 'incompatible',
    });
  });

  it('новейшая несовместима: incompatible с причиной; явная запасная ставится', async () => {
    const spec: ExtensionSpec = {
      id: 'acme.echo',
      version: '2.0.0',
      versions: ['2.0.0', '1.0.0'],
    };
    serveIndex(env.routes, [{ ...spec, minAppVersion: '9.0.0' }]);
    serve(env.routes, { ...spec, minAppVersion: '9.0.0' }, '2.0.0');
    const error = await rejection(env.installer.install('acme.echo'));
    expect(error).toMatchObject({
      cause: 'incompatible',
      message: 'requires app >= 9.0.0',
    });
    expect(
      await rejection(env.installer.install('acme.echo', '2.0.0')),
    ).toMatchObject({
      cause: 'incompatible',
    });
    expect(
      env.fake.calls.filter((c) => c.url.includes('/extensions/')),
    ).toEqual([]);
  });

  it('id из поставки: conflict, файлы не скачиваются', async () => {
    const bundled = await createEnv({
      bundledIds: () => new Set(['acme.echo']),
    });
    serveIndex(bundled.routes, [ECHO]);
    expect(
      await rejection(bundled.installer.install('acme.echo')),
    ).toMatchObject({
      cause: 'conflict',
    });
    expect(bundled.fake.calls).toHaveLength(1);
    await bundled.cleanup();
  });

  it('каталог скопирован вручную (без sidecar): conflict, содержимое цело', async () => {
    publish();
    await installFake(env.dir, 'acme.echo', '0.5.0');
    await nodeFs.remove(
      path.join(env.dir, 'acme.echo', '.spirula-install.json'),
    );
    expect(await rejection(env.installer.install('acme.echo'))).toMatchObject({
      cause: 'conflict',
    });
    expect(await readText(env.dir, 'acme.echo', 'main.mjs')).toBe(
      "export default '0.5.0';",
    );
    expect(
      env.fake.calls.filter((c) => c.url.includes('/extensions/')),
    ).toEqual([]);
  });

  it('второй одновременный install того же id: conflict, первый завершается', async () => {
    publish();
    const first = env.installer.install('acme.echo');
    const second = env.installer.install('acme.echo');
    expect(await rejection(second)).toMatchObject({
      cause: 'conflict',
      message: expect.stringContaining('in progress'),
    });
    expect(await first).toMatchObject({ version: '1.1.0' });
    expect(await env.installer.install('acme.echo')).toMatchObject({
      previousVersion: '1.1.0',
    });
  });

  it('install и uninstall того же id не пересекаются', async () => {
    publish();
    const install = env.installer.install('acme.echo');
    const uninstall = env.installer.uninstall('acme.echo');
    expect(await rejection(uninstall)).toMatchObject({ cause: 'conflict' });
    await install;
  });
});

describe('install: сбой оставляет прежнюю установку нетронутой', () => {
  beforeEach(async () => {
    publish();
    await env.installer.install('acme.echo', '1.0.0');
  });

  const expectUntouched = async (): Promise<void> => {
    expect(await readText(env.dir, 'acme.echo', 'main.mjs')).toBe(
      "export default '1.0.0';",
    );
    const meta = JSON.parse(
      await readText(env.dir, 'acme.echo', '.spirula-install.json'),
    ) as { version: string };
    expect(meta.version).toBe('1.0.0');
    expect(await entriesOf(path.join(env.dir, '.staging'))).toEqual([]);
    expect(await entriesOf(path.join(env.dir, '.trash'))).toEqual([]);
    expect(
      (await entriesOf(env.dir)).filter((name) => name !== '.trash'),
    ).toEqual(['.catalog', '.staging', 'acme.echo']);
  };

  const mainUrl = urlOf('acme.echo', '1.1.0', 'main.mjs');

  it.each([
    ['sha256 не совпал', { body: "export default '1.1.X';" }, 'integrity'],
    ['файл короче заявленного', { body: 'short' }, 'integrity'],
    [
      'файл длиннее заявленного',
      { body: `export default '1.1.0';${'x'.repeat(100)}` },
      'integrity',
    ],
    ['HTTP 404', { status: 404, body: 'missing' }, 'network'],
    ['сеть оборвана', { fail: true }, 'network'],
    [
      'редирект на чужой origin',
      { status: 302, headers: { location: 'https://evil.test/main.mjs' } },
      'network',
    ],
    [
      'петля редиректов',
      { status: 302, headers: { location: mainUrl } },
      'network',
    ],
  ])('%s', async (_name, route, cause) => {
    env.routes.set(mainUrl, route);
    expect(await rejection(env.installer.install('acme.echo'))).toMatchObject({
      cause,
    });
    await expectUntouched();
  });

  it('редирект внутри origin выполняется', async () => {
    const moved = 'https://catalog.test/moved/main.mjs';
    env.routes.set(moved, { body: "export default '1.1.0';" });
    env.routes.set(mainUrl, { status: 301, headers: { location: moved } });
    expect(await env.installer.install('acme.echo')).toMatchObject({
      version: '1.1.0',
    });
    expect(env.fake.calls.map((c) => c.url)).toContain(moved);
  });

  it('таймаут запроса: network', async () => {
    const slow = await createEnv({ requestTimeoutMs: 25 });
    serveIndex(slow.routes, [ECHO]);
    serve(slow.routes, ECHO, '1.1.0');
    slow.routes.set(mainUrl, { hang: true });
    const error = await rejection(slow.installer.install('acme.echo'));
    expect(error).toMatchObject({
      cause: 'network',
      message: expect.stringContaining('timed out after 25 ms'),
    });
    expect(await entriesOf(path.join(slow.dir, '.staging'))).toEqual([]);
    await slow.cleanup();
  });

  it.each([
    ['id', { id: 'acme.other' }],
    ['версия', { version: '1.1.1' }],
    ['разрешения', { permissions: ['network'] }],
    ['вклады', { contributes: contributesOf(['acme.evil']) }],
  ])('манифест расходится с индексом: %s', async (_name, manifest) => {
    const lying: ExtensionSpec = { ...ECHO, manifest };
    serveIndex(env.routes, [lying]);
    serve(env.routes, lying, '1.1.0');
    await env.installer.catalog({ refresh: true });
    expect(await rejection(env.installer.install('acme.echo'))).toMatchObject({
      cause: 'invalid',
    });
    await expectUntouched();
  });

  it('inspectDir отклонил каталог: invalid с сообщением проверки', async () => {
    const strict = env.restart({
      inspectDir: async () => ({ ok: false, message: 'main is missing' }),
    });
    expect(await rejection(strict.install('acme.echo'))).toMatchObject({
      cause: 'invalid',
      message: 'main is missing',
    });
    await expectUntouched();
  });

  it('sidecar пишется после проверки: inspectDir видит только скачанные файлы', async () => {
    const seen: string[] = [];
    const spying = env.restart({
      inspectDir: async (dir) => {
        seen.push(...(await readdir(dir)).sort());
        return { ok: false, message: 'stop' };
      },
    });
    await rejection(spying.install('acme.echo'));
    expect(seen).toEqual(['extension.json', 'main.mjs']);
  });

  it('второй rename не удался: прежний каталог возвращён, ошибка проброшена', async () => {
    const failing = env.restart({
      fs: {
        ...nodeFs,
        rename: async (from, to) => {
          if (from.includes(`${path.sep}.staging${path.sep}`)) {
            throw new Error('rename failed');
          }
          return nodeFs.rename(from, to);
        },
      },
    });
    await expect(failing.install('acme.echo')).rejects.toThrow('rename failed');
    await expectUntouched();
  });

  it('прежний каталог не удалось вернуть: ошибка в логе, исходная ошибка проброшена', async () => {
    const failing = env.restart({
      fs: {
        ...nodeFs,
        rename: async (from, to) => {
          if (from.includes(`${path.sep}.staging${path.sep}`)) {
            throw new Error('rename failed');
          }
          if (from.includes(`${path.sep}.trash${path.sep}`)) {
            throw new Error('restore failed');
          }
          return nodeFs.rename(from, to);
        },
      },
    });
    await expect(failing.install('acme.echo')).rejects.toThrow('rename failed');
    expect(env.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringContaining('could not be restored'),
    );
    const trash = await readdir(path.join(env.dir, '.trash'));
    expect(trash).toHaveLength(1);
    expect(
      await readFile(
        path.join(env.dir, '.trash', trash[0] ?? '', 'main.mjs'),
        'utf8',
      ),
    ).toBe("export default '1.0.0';");
  });

  it('повторная попытка после сбоя проходит', async () => {
    env.routes.set(mainUrl, { fail: true });
    await rejection(env.installer.install('acme.echo'));
    env.routes.set(mainUrl, { body: "export default '1.1.0';" });
    expect(await env.installer.install('acme.echo')).toMatchObject({
      version: '1.1.0',
    });
    expect((await stat(path.join(env.dir, 'acme.echo'))).isDirectory()).toBe(
      true,
    );
  });
});
