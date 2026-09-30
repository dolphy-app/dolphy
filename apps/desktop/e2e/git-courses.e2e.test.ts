import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { GitClient } from './support/git-client.ts';
import { courseTree, readRepositories, REMOTE_COURSE } from './support/git.ts';
import { serveGitRepo } from '../../../packages/testkit/src/git-server.ts';
import type { GitServer } from '../../../packages/testkit/src/git-server.ts';

const COMMIT = /^[0-9a-f]{40}$/;

let workspace: Workspace;
let app: DolphyApp | null = null;
let client: GitClient;
let server: GitServer | null = null;

const start = async () => {
  app = await launchApp(workspace.userData);
  client = new GitClient(app.page);
};

const stop = async () => {
  await app?.close();
  app = null;
};

/** Снимки репозиториев в библиотеке приложения (пусто, если каталога нет). */
const snapshots = () => {
  const dir = join(workspace.userData, 'library', 'repositories');
  return existsSync(dir) ? readdirSync(dir) : [];
};

/** Путь с сегментом `.git` в дереве снимка (их там быть не должно). */
const hasGitDir = (root: string): boolean =>
  readdirSync(root, { withFileTypes: true }).some(
    (entry) =>
      entry.name === '.git' ||
      (entry.isDirectory() && hasGitDir(join(root, entry.name))),
  );

beforeEach(async () => {
  workspace = await createWorkspace();
});

afterEach(async () => {
  await stop();
  await server?.close();
  server = null;
  await workspace?.dispose();
});

describe('курсы из git-репозитория', () => {
  it('добавить, пережить перезапуск, обновить до нового коммита и удалить', async () => {
    server = await serveGitRepo({
      name: 'course',
      files: courseTree(),
      branch: 'main',
    });
    const firstCommit = server.revParse('main');
    await start();

    // (2) «Добавить из Git» → карточка курса в сетке без перезапуска
    await client.openCourses();
    const before = await client.courseNames();
    expect(before).not.toContain(REMOTE_COURSE.name);
    await client.openAddDialog();
    await client.submitAdd(server.urlOf('course'));
    await client.waitAdded();
    await client.courseCard(REMOTE_COURSE.name).waitFor({ timeout: 15_000 });
    expect((await client.courseNames()).sort()).toEqual(
      [...before, REMOTE_COURSE.name].sort(),
    );

    // (3) снимок на диске без .git, строка в реестре engine.db с коммитом
    const [repository, ...rest] = readRepositories(workspace.userData);
    expect(rest).toEqual([]);
    expect(repository).toMatchObject({
      commit: firstCommit,
      courseIds: [REMOTE_COURSE.id],
    });
    expect(repository?.commit).toMatch(COMMIT);
    const { id, url } = repository ?? { id: '', url: '' };
    expect(url).toContain(new URL(server.url).host);
    expect(snapshots()).toEqual([id]);
    const snapshot = join(workspace.userData, 'library', 'repositories', id);
    expect(
      existsSync(join(snapshot, REMOTE_COURSE.id, 'course_manifest.json')),
    ).toBe(true);
    expect(hasGitDir(snapshot)).toBe(false);

    // (7) перезапуск: реестр, снимок и курс на месте, сеть не нужна
    await stop();
    await start();
    await client.openCourses();
    await client.courseCard(REMOTE_COURSE.name).waitFor({ timeout: 15_000 });
    expect(readRepositories(workspace.userData)).toEqual([repository]);
    expect(snapshots()).toEqual([id]);

    // (4) Settings → Library: репозиторий виден; «Обновить» без новых коммитов
    await client.openLibrarySettings();
    const [row, ...others] = await client.repositories();
    expect(others).toEqual([]);
    expect(row).toMatchObject({ url, status: 'Готов' });
    expect(row?.details).toContain(firstCommit.slice(0, 7));
    expect(row?.details).toContain('1 курс');
    await client.updateRepository(url);
    await client.waitUpdateNotice('up-to-date');
    expect(readRepositories(workspace.userData)).toEqual([repository]);

    // новый коммит на сервере → «Обновить» подтягивает его
    expect(await client.lessonNames(REMOTE_COURSE.id)).toEqual(
      expect.arrayContaining([expect.stringContaining(REMOTE_COURSE.lesson)]),
    );
    const secondCommit = server.commit(
      courseTree({ lessonName: REMOTE_COURSE.updatedLesson }),
      'rename lesson',
    );
    expect(secondCommit).not.toBe(firstCommit);
    await client.openLibrarySettings();
    await client.updateRepository(url);
    await client.waitUpdateNotice('updated');
    await expect
      .poll(() => readRepositories(workspace.userData)[0]?.commit, {
        timeout: 30_000,
      })
      .toBe(secondCommit);
    expect(readRepositories(workspace.userData)[0]).toMatchObject({
      id,
      courseIds: [REMOTE_COURSE.id],
    });
    expect(snapshots()).toEqual([id]);
    expect(hasGitDir(snapshot)).toBe(false);
    const lessons = await client.lessonNames(REMOTE_COURSE.id);
    expect(lessons).toEqual(
      expect.arrayContaining([
        expect.stringContaining(REMOTE_COURSE.updatedLesson),
      ]),
    );
    expect(lessons.join('\n')).not.toContain(REMOTE_COURSE.lesson);

    // (6) «Удалить» с подтверждением: карточка, каталог и запись исчезают
    await client.openLibrarySettings();
    await client.removeRepository(url);
    expect(await client.repositories()).toEqual([]);
    expect(await client.emptyListShown()).toBe(true);
    expect(readRepositories(workspace.userData)).toEqual([]);
    expect(snapshots()).toEqual([]);
    expect(existsSync(snapshot)).toBe(false);
    await client.openCourses();
    await expect
      .poll(() => client.courseNames(), { timeout: 15_000 })
      .toEqual(before);
  });

  it('ошибки остаются в диалоге и не меняют библиотеку, после исправления адрес принимается', async () => {
    server = await serveGitRepo([
      { name: 'course', files: courseTree(), branch: 'main' },
      // курс с id, который уже занят курсом из dev:seed
      {
        name: 'clash',
        files: courseTree({ id: REMOTE_COURSE.seededId }),
        branch: 'main',
      },
      { name: 'empty', files: { 'README.md': 'нет курсов\n' } },
    ]);
    await start();
    await client.openCourses();
    const before = await client.courseNames();
    const unchanged = async () => {
      expect(await client.courseNames()).toEqual(before);
      expect(readRepositories(workspace.userData)).toEqual([]);
      expect(snapshots()).toEqual([]);
    };
    await client.openAddDialog();

    // неверный адрес отвергается до обращения к сети
    await client.submitAdd('ftp://127.0.0.1/course.git');
    expect(await client.dialogError()).toContain('http:// или https://');
    await unchanged();

    // недоступный хост
    await client.submitAdd('http://127.0.0.1:1/course.git');
    expect(await client.dialogError()).toContain('Нет связи с сервером');
    await unchanged();

    // сервер отвечает, но такого репозитория нет
    await client.submitAdd(server.urlOf('missing'));
    expect(await client.dialogError()).toContain('Репозиторий не найден');
    await unchanged();

    // репозиторий без курсов
    await client.submitAdd(server.urlOf('empty'));
    expect(await client.dialogError()).toContain('не найдено ни одного курса');
    await unchanged();

    // курс с занятым id отклоняется библиотекой, прежний граф цел
    await client.submitAdd(server.urlOf('clash'));
    expect(await client.dialogError()).toContain('Библиотека отклонила');
    await unchanged();

    // тот же диалог принимает верный адрес
    await client.submitAdd(server.urlOf('course'));
    await client.waitAdded();
    await client.courseCard(REMOTE_COURSE.name).waitFor({ timeout: 15_000 });
    expect(readRepositories(workspace.userData)).toHaveLength(1);
    expect(snapshots()).toHaveLength(1);
  });

  it('принимает репозиторий с курсом в корне', async () => {
    server = await serveGitRepo({
      name: 'root',
      files: courseTree({ atRoot: true }),
      branch: 'main',
    });
    await start();
    await client.openCourses();
    const before = await client.courseNames();
    await client.openAddDialog();
    await client.submitAdd(server.urlOf('root'));
    await client.waitAdded();
    await client.courseCard(REMOTE_COURSE.name).waitFor({ timeout: 15_000 });
    expect((await client.courseNames()).sort()).toEqual(
      [...before, REMOTE_COURSE.name].sort(),
    );

    const [repository, ...rest] = readRepositories(workspace.userData);
    expect(rest).toEqual([]);
    expect(repository).toMatchObject({
      commit: server.revParse('main'),
      courseIds: [REMOTE_COURSE.id],
    });
    const id = repository?.id ?? '';
    expect(snapshots()).toEqual([id]);
    const snapshot = join(workspace.userData, 'library', 'repositories', id);
    expect(existsSync(join(snapshot, 'course_manifest.json'))).toBe(true);
    expect(hasGitDir(snapshot)).toBe(false);
  });
});
