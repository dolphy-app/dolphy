import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  seedCatalogInstall,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import {
  ECHO,
  ECHO_COURSE,
  MARKDOWN,
  markdownCourse,
} from './support/courses.ts';
import { expectText } from './support/locator.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const ECHO_1_0: CatalogSource = {
  dir: fixture('echo-extension'),
  name: 'Echo',
  description: 'Вид заданий «эхо» для проверки',
  author: 'acme',
};
const ECHO_1_1: CatalogSource = {
  ...ECHO_1_0,
  dir: fixture('echo-extension-1.1.0'),
};
const SUNRISE: CatalogSource = {
  dir: join(CATALOG_FIXTURES, 'sunrise-1.0.0'),
  name: 'Sunrise',
  description: 'Тёплая светлая тема «Рассвет»',
  author: 'acme',
};
const GOOD_MARKDOWN: CatalogSource = {
  dir: fixture('good-markdown-extension'),
  name: 'Good markdown',
  description: 'Рендерер блоков good',
  author: 'acme',
};
const POLICY: CatalogSource = {
  dir: fixture('policy-extension'),
  name: 'Policy',
  description: 'Правило оценки',
  author: 'acme',
};

const SUNRISE_THEME = 'Рассвет';
const SUNRISE_BACKGROUND = 'rgb(255, 244, 229)';
const BUILTIN_BACKGROUNDS = ['rgb(245, 246, 251)', 'rgb(14, 16, 32)'];

let workspace: Workspace;
let server: CatalogServer | null = null;
let app: DolphyApp | null = null;

const launch = async (...sources: CatalogSource[]) => {
  server = await startCatalogServer(sources);
  app = await launchApp(workspace.userData, catalogEnv(server.url));
  return { client: new Client(app.page), catalog: new CatalogClient(app.page) };
};

/** Второе окно того же приложения: в нём меняют расширения, пока первое открыто на своём экране. */
const secondWindow = async () => {
  const page = await app!.openWindow();
  return { client: new Client(page), catalog: new CatalogClient(page) };
};

const installFromCatalog = async (
  window: { client: Client; catalog: CatalogClient },
  id: string,
) => {
  await window.client.openSettingsExtensions();
  await window.catalog.openCatalogTab();
  await window.catalog.installButton(id).click();
  await window.catalog.confirmInstall();
  await window.catalog.closeDialog();
};

beforeEach(async () => {
  workspace = await createWorkspace({
    libraryFiles: { ...ECHO_COURSE, ...markdownCourse('good') },
  });
});

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace.dispose();
});

describe('живое применение расширений', () => {
  it('R1: темы, правила оценки и рендерер, установленные в другом окне, действуют в открытом без перезагрузки', async () => {
    const first = await launch(SUNRISE, GOOD_MARKDOWN, POLICY);

    // открыто: условие с блоком good (без рендерера — обычный код), настройки обучения
    await first.client.openCourses();
    await first.client.focusCourse(MARKDOWN);
    await first.client.startSession();
    const plain = first.client.page.locator('pre code', { hasText: 'hello' });
    await plain.first().waitFor();
    expect(await first.client.page.locator('.dolphy-md-block').count()).toBe(0);
    const stillSameWindow = await first.client.markWindow();

    const second = await secondWindow();
    await installFromCatalog(second, 'acme.good-markdown');
    await installFromCatalog(second, 'acme.sunrise');
    await installFromCatalog(second, 'acme.policy');

    // блок перевыведен рендерером расширения: исходник заменён
    const block = first.client.page.locator(
      '.dolphy-md-block[data-language=good]',
    );
    await expect
      .poll(() => block.getAttribute('data-state'), { timeout: 30_000 })
      .toBe('done');
    await first.client.page
      .getByText('good block: hello', { exact: true })
      .waitFor({ state: 'visible' });

    await first.client.page
      .getByRole('button', { name: 'Выйти из сессии', exact: true })
      .click();
    await first.client.openSettingsAppearance();
    await expect
      .poll(() => first.client.themeTileExists(SUNRISE_THEME))
      .toBe(true);
    await first.client.openSettingsLearning();
    await first.client.selectGradePolicy('Generous');
    await stillSameWindow();
  });

  it('R1: вид задания, установленный в другом окне, доступен новой попытке', async () => {
    const first = await launch(ECHO_1_0);
    await first.client.openCourses();
    await first.client.focusCourse(ECHO);
    await first.client.startSession();
    // вида задания ещё нет: упражнение не открывается, предлагается повторить
    const retry = first.client.page.getByRole('button', {
      name: 'Повторить',
      exact: true,
    });
    await expectText(
      first.client.page.locator('body'),
      'Exercise type is unavailable',
    );
    const stillSameWindow = await first.client.markWindow();

    const second = await secondWindow();
    await installFromCatalog(second, 'acme.echo');

    await retry.click();
    expect((await first.client.currentExercise()).verifiable).toBe(true);
    const summary = await first.client.runSession(() => ({ text: '42' }));
    expect(summary.passed).toBe(1);
    await stillSameWindow();
  });

  it('R2: удаление расширения выбранной темы: окно сразу «Как в системе», выбор в настройках возвращается вместе с расширением', async () => {
    const { client, catalog } = await launch(SUNRISE);
    await installFromCatalog({ client, catalog }, 'acme.sunrise');
    await client.openSettingsAppearance();
    await client.selectTheme(SUNRISE_THEME);
    await expect.poll(() => client.appBackground()).toBe(SUNRISE_BACKGROUND);
    const stillSameWindow = await client.markWindow();

    await client.openSettingsExtensions();
    await catalog.openRemoveDialog('acme.sunrise');
    await catalog.confirmRemove();
    await expect
      .poll(async () =>
        BUILTIN_BACKGROUNDS.includes(await client.appBackground()),
      )
      .toBe(true);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(false);
    expect(await client.isThemeSelected('Как в системе')).toBe(true);

    await installFromCatalog({ client, catalog }, 'acme.sunrise');
    await expect.poll(() => client.appBackground()).toBe(SUNRISE_BACKGROUND);
    await client.openSettingsAppearance();
    expect(await client.isThemeSelected(SUNRISE_THEME)).toBe(true);
    await stillSameWindow();
  });

  it('R3: обновление при смонтированном виде ответа в другом окне: компонент заменяется без перезагрузки и баннера, введённый ответ цел, проверка идёт в новую версию', async () => {
    server = await startCatalogServer([ECHO_1_1]);
    await seedCatalogInstall(workspace.userData, {
      id: 'acme.echo',
      dir: ECHO_1_0.dir,
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    const first = {
      client: new Client(app.page),
      catalog: new CatalogClient(app.page),
    };
    await first.client.openCourses();
    await first.client.focusCourse(ECHO);
    await first.client.startSession();
    await first.client.fillAnswer({ text: '41' });
    const stillSameWindow = await first.client.markWindow();

    const second = await secondWindow();
    await second.client.openSettingsExtensions();
    await expectText(second.catalog.updatesBanner(), 'Доступно обновлений: 1');
    await second.catalog.updateFromRow('acme.echo');
    await second.catalog.confirmInstall();
    await second.catalog.closeDialog();
    expect(await second.catalog.installedText('acme.echo')).toContain(
      'Из каталога v1.1.0',
    );

    // новая ревизия пересоздаёт компонент без перезагрузки окна; ответ цел
    const element = first.client.page.getByTestId('acme-echo-answer');
    await element
      .and(first.client.page.locator('[data-version="1.1.0"]'))
      .waitFor({ timeout: 30_000 });
    expect(await element.locator('input').inputValue()).toBe('41');

    // 1.0.0 отверг бы «41»; 1.1.0 засчитывает: вердикт даёт новая версия
    await first.client.page
      .getByRole('button', { name: 'Проверить', exact: true })
      .click();
    await first.client.page
      .getByText('Верно', { exact: true })
      .waitFor({ timeout: 30_000 });
    await stillSameWindow();

    // новое монтирование берёт новые файлы
    // курс уже в фокусе (общая настройка): второе окно начинает с плана
    await second.client.openPlan();
    await second.client.startSession();
    await second.client.page
      .locator('[data-testid="acme-echo-answer"][data-version="1.1.0"]')
      .waitFor({ timeout: 30_000 });
  });
});
