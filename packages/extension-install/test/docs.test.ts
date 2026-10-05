import {
  mkdir,
  readFile,
  readdir,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExtensionInstallError } from '@dolphy-app/engine/ports';
import {
  CATALOG_URL,
  callsTo,
  createEnv,
  installFake,
  serve,
  serveIndex,
  sha256,
  urlOf,
} from './helpers.ts';
import type { Env, ExtensionSpec } from './helpers.ts';

let env: Env;
beforeEach(async () => {
  env = await createEnv();
});
afterEach(() => env.cleanup());

const ID = 'acme.docs';
const README = '# Docs\n\nПривет, мир.\n';
const CHANGELOG = '## 1.1.0\n\n- second\n\n## 1.0.0\n\n- first\n';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const spec = (extra: Partial<ExtensionSpec> = {}): ExtensionSpec => ({
  id: ID,
  version: '1.1.0',
  versions: ['1.1.0', '1.0.0'],
  extraFiles: {
    'README.md': README,
    'CHANGELOG.md': CHANGELOG,
    'docs/shot.png': PNG,
  },
  ...extra,
});

const publish = (extra: Partial<ExtensionSpec> = {}) => {
  const entry = spec(extra);
  serveIndex(env.routes, [entry]);
  serve(env.routes, entry, '1.1.0');
  serve(env.routes, entry, '1.0.0');
  return entry;
};

const failureOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ExtensionInstallError);
  return (error as ExtensionInstallError).cause;
};

const readmeCalls = () =>
  callsTo(env.fake.calls, urlOf(ID, '1.1.0', 'README.md'));

describe('versionFile: кэш по sha256', () => {
  it('скачивает с проверкой и кладёт в .catalog/files/<sha256>; повтор идёт из кэша', async () => {
    publish();
    const first = await env.installer.versionFile(ID, '1.1.0', 'README.md');
    expect(Buffer.from(first.bytes).toString()).toBe(README);
    expect(first.source).toBe('catalog');
    const cached = path.join(env.dir, '.catalog', 'files', sha256(README));
    expect(await readFile(cached, 'utf8')).toBe(README);
    await env.installer.versionFile(ID, '1.1.0', 'README.md');
    expect(readmeCalls()).toHaveLength(1);
  });

  it('подмена файла на сервере — integrity, в кэш ничего не попадает', async () => {
    publish();
    env.routes.set(urlOf(ID, '1.1.0', 'README.md'), { body: '# Evil\n' });
    expect(
      await failureOf(env.installer.versionFile(ID, '1.1.0', 'README.md')),
    ).toBe('integrity');
    expect(
      await readdir(path.join(env.dir, '.catalog', 'files')).catch(() => []),
    ).toEqual([]);
  });

  it('нет записи, версии или файла — not-found; слишком большой файл — limits', async () => {
    publish({ extraFiles: { 'README.md': 'x'.repeat(1024 * 1024 + 1) } });
    expect(
      await failureOf(
        env.installer.versionFile('acme.none', '1.0.0', 'README.md'),
      ),
    ).toBe('not-found');
    expect(
      await failureOf(env.installer.versionFile(ID, '9.9.9', 'README.md')),
    ).toBe('not-found');
    expect(
      await failureOf(env.installer.versionFile(ID, '1.1.0', 'CHANGELOG.md')),
    ).toBe('not-found');
    expect(
      await failureOf(env.installer.versionFile(ID, '1.1.0', 'README.md')),
    ).toBe('limits');
  });

  it('повреждённая запись кэша отбрасывается и скачивается заново', async () => {
    publish();
    await env.installer.versionFile(ID, '1.1.0', 'README.md');
    const cached = path.join(env.dir, '.catalog', 'files', sha256(README));
    await writeFile(cached, 'garbage');
    const again = await env.installer.versionFile(ID, '1.1.0', 'README.md');
    expect(Buffer.from(again.bytes).toString()).toBe(README);
    expect(readmeCalls()).toHaveLength(2);
    expect(await readFile(cached, 'utf8')).toBe(README);
  });

  it('без сети файл из кэша отдаётся с source=cache, без кэша — network; перезапуск кэш не теряет', async () => {
    publish();
    await env.installer.versionFile(ID, '1.1.0', 'README.md');
    env.clock.advance(60 * 60_000); // индекс устарел: запрос идёт в сеть
    env.routes.clear();
    env.routes.set('https://catalog.test/index.v2.json', { fail: true });
    const offline = env.restart();
    const hit = await offline.versionFile(ID, '1.1.0', 'README.md');
    expect(hit.source).toBe('cache');
    expect(Buffer.from(hit.bytes).toString()).toBe(README);
    expect(
      await failureOf(offline.versionFile(ID, '1.1.0', 'CHANGELOG.md')),
    ).toBe('network');
  });

  it('ready() сокращает кэш до потолка: сначала самые старые, посторонние имена удаляются', async () => {
    const dir = path.join(env.dir, '.catalog', 'files');
    await mkdir(dir, { recursive: true });
    const chunk = 'a'.repeat(9 * 1024 * 1024);
    const names = ['1', '2', '3'].map((n) => sha256(n));
    for (const [position, name] of names.entries()) {
      await writeFile(path.join(dir, name), chunk);
      const time = new Date(Date.now() - (3 - position) * 60_000);
      await utimes(path.join(dir, name), time, time);
    }
    await writeFile(path.join(dir, 'stray.tmp'), 'x');
    await env.installer.ready();
    expect((await readdir(dir)).sort()).toEqual(names.slice(1).sort());
  });
});

describe('docs', () => {
  it('установленная версия читается с диска без сети, обрезка до 64 КиБ по границе символа', async () => {
    await installFake(env.dir, ID, '1.0.0');
    const big = `# Big\n${'я'.repeat(40_000)}`; // 2 байта на символ
    await writeFile(path.join(env.dir, ID, 'README.md'), big);
    await writeFile(path.join(env.dir, ID, 'CHANGELOG.md'), CHANGELOG);
    const docs = await env.installer.docs(ID);
    expect(env.fake.calls).toEqual([]);
    expect(docs).toMatchObject({
      version: '1.0.0',
      source: 'installed',
      changelog: CHANGELOG,
      truncated: true,
    });
    expect(Buffer.byteLength(docs.readme ?? '')).toBeLessThanOrEqual(64 * 1024);
    expect(docs.readme).not.toContain('\uFFFD');
    expect((docs.readme ?? '').startsWith('# Big\n')).toBe(true);
  });

  it('без README в установленном каталоге — readme null; README-ссылка не читается', async () => {
    await installFake(env.dir, ID, '1.0.0');
    expect(await env.installer.docs(ID)).toMatchObject({
      readme: null,
      changelog: null,
      truncated: false,
    });
    await writeFile(path.join(env.dir, 'secret.txt'), 'top secret');
    await symlink('../secret.txt', path.join(env.dir, ID, 'README.md'));
    expect((await env.installer.docs(ID)).readme).toBeNull();
  });

  it('не установленное: новейшая показанная версия каталога, README и CHANGELOG скачиваются', async () => {
    publish();
    const docs = await env.installer.docs(ID);
    expect(docs).toEqual({
      version: '1.1.0',
      readme: README,
      changelog: CHANGELOG,
      truncated: false,
      source: 'catalog',
    });
    const old = await env.installer.docs(ID, '1.0.0');
    expect(old.version).toBe('1.0.0');
  });

  it('установленная версия просит другую: тексты берутся из каталога', async () => {
    publish();
    await installFake(env.dir, ID, '1.0.0');
    await writeFile(path.join(env.dir, ID, 'README.md'), '# Installed\n');
    expect((await env.installer.docs(ID)).readme).toBe('# Installed\n');
    const latest = await env.installer.docs(ID, '1.1.0');
    expect(latest).toMatchObject({
      version: '1.1.0',
      readme: README,
      source: 'catalog',
    });
  });

  it('без сети показывает кэш с source=cache; без кэша — network; нет индекса — catalog-unavailable', async () => {
    publish();
    await env.installer.docs(ID);
    env.clock.advance(60 * 60_000);
    env.routes.clear();
    env.routes.set('https://catalog.test/index.v2.json', { fail: true });
    expect(await env.installer.docs(ID)).toMatchObject({
      source: 'cache',
      readme: README,
    });
    expect(
      await failureOf(env.installer.docImage(ID, '1.1.0', 'docs/shot.png')),
    ).toBe('network');
    const fresh = await createEnv();
    fresh.routes.set('https://catalog.test/index.v2.json', { fail: true });
    expect(await failureOf(fresh.installer.docs(ID))).toBe(
      'catalog-unavailable',
    );
    await fresh.cleanup();
  });

  it('неизвестное расширение и версия — not-found', async () => {
    publish();
    expect(await failureOf(env.installer.docs('acme.none'))).toBe('not-found');
    expect(await failureOf(env.installer.docs(ID, '7.0.0'))).toBe('not-found');
  });
});

describe('docImage', () => {
  it('возвращает data:-URI картинки версии из каталога и кэширует её', async () => {
    publish();
    const uri = await env.installer.docImage(ID, '1.1.0', 'docs/shot.png');
    expect(uri).toBe(
      `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    );
    await env.installer.docImage(ID, '1.1.0', 'docs/shot.png');
    expect(
      callsTo(env.fake.calls, urlOf(ID, '1.1.0', 'docs/shot.png')),
    ).toHaveLength(1);
  });

  it('картинка установленной версии читается с диска', async () => {
    await installFake(env.dir, ID, '1.0.0');
    await mkdir(path.join(env.dir, ID, 'docs'), { recursive: true });
    await writeFile(path.join(env.dir, ID, 'docs', 'a.jpeg'), PNG);
    expect(await env.installer.docImage(ID, '1.0.0', 'docs/a.jpeg')).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    expect(
      await failureOf(env.installer.docImage(ID, '1.0.0', 'docs/none.png')),
    ).toBe('not-found');
  });

  it('недопустимые типы и пути — invalid, больше 256 КиБ — limits без скачивания, нет файла — not-found', async () => {
    publish({
      extraFiles: {
        'README.md': README,
        'big.png': new Uint8Array(256 * 1024 + 1),
      },
    });
    for (const bad of [
      'anim.gif',
      'README.md',
      '../x.png',
      '/etc/p.png',
      'a//b.png',
      'docs/.hidden.png',
    ]) {
      expect(
        await failureOf(env.installer.docImage(ID, '1.1.0', bad)),
        bad,
      ).toBe('invalid');
    }
    expect(
      await failureOf(env.installer.docImage(ID, '1.1.0', 'big.png')),
    ).toBe('limits');
    expect(callsTo(env.fake.calls, urlOf(ID, '1.1.0', 'big.png'))).toHaveLength(
      0,
    );
    expect(
      await failureOf(env.installer.docImage(ID, '1.1.0', 'missing.png')),
    ).toBe('not-found');
  });
});

describe('deprecated и elsewhere в каталоге', () => {
  it('deprecationOf: диапазон версий, названия альтернатив из индекса, null без записи', async () => {
    const entries: ExtensionSpec[] = [
      {
        id: 'acme.old',
        version: '2.0.0',
        versions: ['2.0.0', '1.0.0'],
        deprecated: {
          versions: '<2.0.0',
          reason: 'Replaced',
          alternatives: ['acme.new', 'acme.gone'],
        },
      },
      { id: 'acme.new', name: 'New one', version: '1.0.0' },
    ];
    serveIndex(env.routes, entries);
    await env.installer.catalog();
    expect(env.installer.deprecationOf('acme.old', '1.0.0', CATALOG_URL)).toEqual({
      versions: '<2.0.0',
      reason: 'Replaced',
      alternatives: [
        { id: 'acme.new', name: 'New one' },
        { id: 'acme.gone', name: null },
      ],
    });
    expect(env.installer.deprecationOf('acme.old', '2.0.0', CATALOG_URL)).toBeNull();
    expect(env.installer.deprecationOf('acme.new', '1.0.0', CATALOG_URL)).toBeNull();
    expect(env.installer.deprecationOf('acme.none', '1.0.0', CATALOG_URL)).toBeNull();
    expect(env.installer.deprecationOf('acme.old', 'not-semver', CATALOG_URL)).toBeNull();
  });

  it('запись каталога: deprecated по показанной версии, versions с совместимостью и журналом, elsewhere', async () => {
    const entries: ExtensionSpec[] = [
      {
        id: 'acme.old',
        version: '2.0.0',
        versions: ['2.0.0', '1.0.0'],
        minAppByVersion: { '2.0.0': '9.0.0' },
        deprecated: {
          versions: '<2.0.0',
          reason: 'Replaced',
          alternatives: [],
        },
        extraFiles: { 'CHANGELOG.md': CHANGELOG },
      },
      { id: 'acme.manual', version: '1.0.0' },
      { id: 'acme.bundled', version: '1.0.0' },
      { id: 'acme.fromhere', version: '1.0.0' },
    ];
    serveIndex(env.routes, entries);
    await mkdir(path.join(env.dir, 'acme.manual'), { recursive: true });
    await installFake(env.dir, 'acme.fromhere', '1.0.0');
    const installer = env.restart({
      bundledIds: () => new Set(['acme.bundled']),
    });
    const byId = Object.fromEntries(
      (await installer.catalog()).entries.map((e) => [e.id, e]),
    );
    const old = byId['acme.old'];
    // 2.0.0 несовместима → показана 1.0.0-запись fallback? shown = новейшая (несовместимая) 2.0.0, диапазон <2.0.0 к ней не относится
    expect(old?.status).toBe('incompatible');
    expect(old?.deprecated).toBeNull();
    expect(
      old?.versions.map((v) => [v.version, v.compatible, v.hasChangelog]),
    ).toEqual([
      ['2.0.0', false, true],
      ['1.0.0', true, true],
    ]);
    expect(old?.versions[0]?.incompatible).toMatchObject({ reason: 'app' });
    expect(old?.versions[1]?.incompatible).toBeNull();
    expect(byId['acme.manual']?.elsewhere).toBe(true);
    expect(byId['acme.bundled']?.elsewhere).toBe(true);
    expect(byId['acme.fromhere']?.elsewhere).toBe(false);
    expect(byId['acme.fromhere']?.installedVersion).toBe('1.0.0');
    expect(byId['acme.old']?.elsewhere).toBe(false);
  });

  it('deprecated попадает в карточку, когда показанная версия под диапазоном', async () => {
    serveIndex(env.routes, [
      {
        id: 'acme.old',
        version: '1.0.0',
        deprecated: { versions: null, reason: 'Abandoned', alternatives: [] },
      },
    ]);
    const [entry] = (await env.installer.catalog()).entries;
    expect(entry?.deprecated).toEqual({
      versions: null,
      reason: 'Abandoned',
      alternatives: [],
    });
    expect(entry?.status).toBe('available');
  });
});
