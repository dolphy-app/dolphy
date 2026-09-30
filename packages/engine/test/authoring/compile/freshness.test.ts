import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeArtifact } from '../../../src/authoring/artifact.ts';
import type { Artifact } from '../../../src/authoring/artifact.ts';
import { compile } from '../../../src/authoring/compile.ts';
import {
  checkFreshness,
  probeArtifact,
} from '../../../src/authoring/freshness.ts';
import { createNodeFsCourseSource } from '../../../src/node/index.ts';
import type { CourseSource } from '../../../src/ports/index.ts';
import { generateLibrary } from '../../helpers/gen.ts';

const HOUR_MS = 3_600_000;
const hasGit = spawnSync('git', ['--version']).status === 0;

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Все файлы библиотеки «давно» изменены, артефакт — новее их всех. */
const backdate = (root: string) => {
  const past = new Date(Date.now() - HOUR_MS);
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      utimesSync(`${entry.parentPath}/${entry.name}`, past, past);
    }
  }
};

const setup = async () => {
  const root = mkdtempSync(`${tmpdir()}/freshness-`);
  created.push(root);
  generateLibrary({
    out: root,
    lessons: 20,
    exercises: 3,
    courses: 2,
    layout: 'json',
    seed: 3,
  });
  backdate(root);
  const source = createNodeFsCourseSource(root);
  const { artifact } = await compile(source);
  if (artifact === null) throw new Error('the generated library must compile');
  await source.writeArtifact(encodeArtifact(artifact));
  return { root, source, artifact };
};

const FILE = 'c00/l00001/e0/front.md';

const freshnessOf = (root: string, artifact: Artifact) =>
  checkFreshness(createNodeFsCourseSource(root), artifact);

/** Наивная проверка «какой-то файл новее артефакта» — отрицательный контроль. */
const naiveMtimeNewer = (root: string) => {
  const built = statSync(`${root}/.engine/compiled.json`).mtimeMs;
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !e.parentPath.includes('/.'))
    .some((e) => statSync(`${e.parentPath}/${e.name}`).mtimeMs > built);
};

/** Независимый пересчёт revision: файлы без dot-каталогов, порядок UTF-16. */
const independentRevision = (root: string) => {
  const paths = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `${e.parentPath}/${e.name}`.slice(root.length + 1))
    .filter(
      (path) =>
        !path
          .split('/')
          .some((part, i, all) => i < all.length - 1 && part.startsWith('.')),
    )
    .sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    const bytes = readFileSync(`${root}/${path}`);
    hash.update(`${path}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
};

describe('checkFreshness (T-37)', () => {
  it('an untouched library is fresh through the stat fingerprint', async () => {
    const { root, artifact } = await setup();
    expect(await freshnessOf(root, artifact)).toEqual({
      fresh: true,
      via: 'stat',
    });
  });

  it('(1) an edit of the same size with a restored mtime is detected through ctime', async () => {
    const { root, artifact } = await setup();
    const path = `${root}/${FILE}`;
    const before = statSync(path);
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, original.replace('answer', 'answEr'));
    utimesSync(path, before.atime, before.mtime);
    const after = statSync(path);
    // предпосылка: (size, mtime) не изменились, поэтому mtime-проверка слепа
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ctimeMs).not.toBe(before.ctimeMs);
    expect(naiveMtimeNewer(root)).toBe(false);
    expect(await freshnessOf(root, artifact)).toEqual({
      fresh: false,
      via: 'revision',
    });
  });

  it('(2) new content with an old mtime is detected; the naive "mtime newer" check misses it', async () => {
    const { root, artifact } = await setup();
    const path = `${root}/${FILE}`;
    const before = statSync(path);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nextra line`);
    utimesSync(path, before.atime, before.mtime);
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
    // отрицательный контроль: наивная функция говорит «ничего не менялось»
    expect(naiveMtimeNewer(root)).toBe(false);
    const result = await freshnessOf(root, artifact);
    expect(result.fresh).toBe(false);
  });

  it('(3) a bare touch keeps the artifact without recompiling and refreshes its stat', async () => {
    const { root, artifact } = await setup();
    const path = `${root}/${FILE}`;
    const now = new Date();
    utimesSync(path, now, now);
    const result = await freshnessOf(root, artifact);
    expect(result.fresh).toBe(true);
    expect(result.via).toBe('revision');
    expect(result.artifact?.stat).not.toBe(artifact.stat);
    expect(result.artifact).toEqual({
      ...artifact,
      stat: result.artifact?.stat,
    });
    // с обновлённым stat следующая проверка снова идёт по быстрому пути
    expect(await freshnessOf(root, result.artifact as Artifact)).toEqual({
      fresh: true,
      via: 'stat',
    });
  });

  it('(3) chmod changes only ctime: the content revision keeps the artifact', async () => {
    const { root, artifact } = await setup();
    chmodSync(`${root}/${FILE}`, 0o600);
    const result = await freshnessOf(root, artifact);
    expect(result.fresh).toBe(true);
    expect(result.via).toBe('revision');
  });

  it.skipIf(!hasGit)(
    '(4) git checkout of a file of the same size gives a new inode and is detected',
    async () => {
      const { root, artifact: initial } = await setup();
      void initial;
      const git = (...args: string[]) =>
        execFileSync(
          'git',
          [
            '-c',
            'user.name=t',
            '-c',
            'user.email=t@example.com',
            '-c',
            'commit.gpgsign=false',
            // фоновая уборка git создаёт и удаляет .git/objects/maintenance.lock,
            // а backdate обходит файлы каталога: ENOENT на utime
            '-c',
            'gc.auto=0',
            '-c',
            'maintenance.auto=false',
            ...args,
          ],
          { cwd: root, stdio: 'pipe' },
        );
      git('init', '-q');
      git('add', '-A');
      git('commit', '-q', '-m', 'one');
      const path = `${root}/${FILE}`;
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, original.replace('answer', 'answEr'));
      git('commit', '-q', '-am', 'two');
      backdate(root);
      const source = createNodeFsCourseSource(root);
      const { artifact } = await compile(source);
      if (artifact === null) throw new Error('must compile');
      expect(await checkFreshness(source, artifact)).toEqual({
        fresh: true,
        via: 'stat',
      });
      git('checkout', 'HEAD~1', '--', FILE);
      expect(readFileSync(path, 'utf8')).toBe(original);
      expect(statSync(path).size).toBe(Buffer.byteLength(original));
      const result = await freshnessOf(root, artifact);
      expect(result).toEqual({ fresh: false, via: 'revision' });
    },
    30_000,
  );

  it('(5) an added, a deleted and a renamed file all make the artifact stale', async () => {
    const added = await setup();
    writeFileSync(`${added.root}/c00/notes.txt`, 'new');
    expect((await freshnessOf(added.root, added.artifact)).fresh).toBe(false);

    const deleted = await setup();
    unlinkSync(`${deleted.root}/c00/l00001/e0/back.md`);
    expect((await freshnessOf(deleted.root, deleted.artifact)).fresh).toBe(
      false,
    );

    const renamed = await setup();
    renameSync(
      `${renamed.root}/c00/l00001/e0/back.md`,
      `${renamed.root}/c00/l00001/e0/back2.md`,
    );
    const result = await freshnessOf(renamed.root, renamed.artifact);
    expect(result).toEqual({ fresh: false, via: 'revision' });
  });

  it('a deleted-then-restored file with the same content is fresh again', async () => {
    const { root, artifact } = await setup();
    const path = `${root}/${FILE}`;
    const content = readFileSync(path);
    unlinkSync(path);
    writeFileSync(path, content);
    const result = await freshnessOf(root, artifact);
    expect(result.fresh).toBe(true);
    expect(result.via).toBe('revision');
  });

  it('(6) another formatVersion is not usable', async () => {
    const { root, artifact } = await setup();
    expect(await freshnessOf(root, { ...artifact, formatVersion: 2 })).toEqual({
      fresh: false,
      via: 'none',
    });
  });

  it('(6) an artifact with errors is not usable', async () => {
    const { root, artifact } = await setup();
    const broken = {
      ...artifact,
      diagnostics: {
        ...artifact.diagnostics,
        summary: { ...artifact.diagnostics.summary, errors: 1 },
      },
    };
    expect((await freshnessOf(root, broken)).via).toBe('none');
  });

  it('(6) probeArtifact: fresh, missing, corrupt and foreign-version artifacts', async () => {
    const { root, source, artifact } = await setup();
    const fresh = await probeArtifact(source);
    expect(fresh.state).toBe('fresh');
    expect(fresh.refreshed).toBe(false);
    expect(fresh.artifact?.revision).toBe(artifact.revision);

    const write = (text: string) => source.writeArtifact(text);
    await write('{"formatVersion":1,');
    expect((await probeArtifact(source)).state).toBe('stale');
    await write(JSON.stringify({ ...artifact, formatVersion: 7 }));
    expect((await probeArtifact(source)).state).toBe('stale');
    rmSync(`${root}/.engine`, { recursive: true });
    expect(await probeArtifact(source)).toEqual({
      state: 'missing',
      artifact: null,
      refreshed: false,
    });
  });

  it('(6) probeArtifact after a bare touch reports the refreshed artifact', async () => {
    const { root, source } = await setup();
    const now = new Date();
    utimesSync(`${root}/${FILE}`, now, now);
    const probe = await probeArtifact(source);
    expect(probe.state).toBe('fresh');
    expect(probe.refreshed).toBe(true);
  });

  it('(7) revision equals an independent recomputation and ignores the traversal order', async () => {
    const { root, artifact } = await setup();
    expect(artifact.revision).toBe(independentRevision(root));
    const reversed: CourseSource = {
      ...createNodeFsCourseSource(root),
      list: async (dir) =>
        [...(await createNodeFsCourseSource(root).list(dir))].reverse(),
    };
    const again = await compile(reversed);
    expect(again.artifact?.revision).toBe(artifact.revision);
    expect(again.artifact?.stat).toBe(artifact.stat);
  });

  it('(7) revision ignores dot-directories and the artifact but counts dot-files as inputs', async () => {
    const { root, source, artifact } = await setup();
    writeFileSync(`${root}/.engine/scratch`, 'x');
    writeFileSync(`${root}/c00/.hidden`, 'x');
    const withHidden = await compile(source);
    // dot-файл — обычный вход, dot-каталог `.engine` — нет
    expect(withHidden.artifact?.revision).not.toBe(artifact.revision);
    unlinkSync(`${root}/c00/.hidden`);
    const withoutHidden = await compile(source);
    expect(withoutHidden.artifact?.revision).toBe(artifact.revision);
    expect(withoutHidden.artifact?.revision).toBe(independentRevision(root));
  });
});
