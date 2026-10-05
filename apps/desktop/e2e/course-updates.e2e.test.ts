import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { GitClient } from './support/git-client.ts';
import { courseTree, readRepositories, REMOTE_COURSE } from './support/git.ts';
import { serveGitRepo } from '../../../packages/testkit/src/git-server.ts';
import type { GitServer } from '../../../packages/testkit/src/git-server.ts';

const TIMEOUT = 30_000;

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

beforeEach(async () => {
  workspace = await createWorkspace();
});

afterEach(async () => {
  await stop();
  await server?.close();
  server = null;
  await workspace?.dispose();
});

describe('обновления курсов из git', () => {
  it('при запуске сообщает об обновлении, на экране «Курсы» обновляет кнопкой, ручная проверка находит новый коммит', async () => {
    server = await serveGitRepo({
      name: 'course',
      files: courseTree(),
      branch: 'main',
    });
    const firstCommit = server.revParse('main');
    await start();
    await client.openCourses();
    await client.openAddDialog();
    await client.submitAdd(server.urlOf('course'));
    await client.waitAdded();
    await client.courseCard(REMOTE_COURSE.name).waitFor({ timeout: 15_000 });
    // коммит совпал с сервером: ни плашки, ни пометки
    expect(await client.updateBanners.count()).toBe(0);
    expect(await client.updatedCourseCard(REMOTE_COURSE.name).count()).toBe(0);

    // пока приложение закрыто, у курса выходит новая редакция
    await stop();
    const secondCommit = server.commit(
      courseTree({ lessonName: REMOTE_COURSE.updatedLesson }),
      'rename lesson',
    );
    expect(secondCommit).not.toBe(firstCommit);

    // (1) открытие приложения: уведомление с названием курса
    await start();
    await client.startupNotice.waitFor({ timeout: TIMEOUT });
    expect(await client.startupNotice.innerText()).toContain(
      REMOTE_COURSE.name,
    );

    // (2) «К курсам»: плашка и пометка на карточке; уведомление ушло
    await client.openCoursesFromNotice();
    await client.updateBanners.first().waitFor({ timeout: TIMEOUT });
    expect(await client.updateBanners.first().innerText()).toContain(
      REMOTE_COURSE.name,
    );
    await client
      .updatedCourseCard(REMOTE_COURSE.name)
      .waitFor({ timeout: TIMEOUT });
    await client.startupNotice.waitFor({ state: 'detached', timeout: TIMEOUT });
    // реестр не тронут: проверка ничего не скачивала
    expect(readRepositories(workspace.userData)[0]?.commit).toBe(firstCommit);

    // «Настройки → Библиотека»: метка в строке репозитория
    await client.openLibrarySettings();
    await client.page
      .locator('li.item')
      .getByText('Есть обновление', { exact: true })
      .waitFor({ timeout: TIMEOUT });
    await client.openCourses();
    await client.updateBanners.first().waitFor({ timeout: TIMEOUT });

    // (3) «Обновить» в плашке: коммит загружен, плашка и пометка исчезли
    await client.updateFromBanner();
    await client.updateBanners.first().waitFor({
      state: 'detached',
      timeout: TIMEOUT,
    });
    await expect
      .poll(() => readRepositories(workspace.userData)[0]?.commit, {
        timeout: TIMEOUT,
      })
      .toBe(secondCommit);
    expect(await client.updatedCourseCard(REMOTE_COURSE.name).count()).toBe(0);

    // (4) ручная проверка: актуально, затем новый коммит на сервере
    await client.checkUpdates();
    await client.waitCheckNotice('up-to-date');
    server.commit(
      courseTree({ lessonName: REMOTE_COURSE.lesson }),
      'revert lesson name',
    );
    await client.checkUpdates();
    await client.waitCheckNotice('found');
    await client.updateBanners.first().waitFor({ timeout: TIMEOUT });
    await client
      .updatedCourseCard(REMOTE_COURSE.name)
      .waitFor({ timeout: TIMEOUT });
  });
});
