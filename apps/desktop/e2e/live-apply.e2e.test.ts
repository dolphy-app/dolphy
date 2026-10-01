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
import { ANSWER_FRAME, Client } from './support/client.ts';
import {
  ECHO,
  ECHO_COURSE,
  MARKDOWN,
  markdownCourse,
} from './support/courses.ts';
import { expectCount, expectText } from './support/locator.ts';

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

const MARKDOWN_FRAME = 'iframe[sandbox][data-mode="markdown"]';
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

    // блок перевыведен рендерером расширения: в рамке, исходник заменён
    const block = first.client.page.locator(
      '.dolphy-md-block[data-language=good]',
    );
    await expect
      .poll(() => block.getAttribute('data-state'), { timeout: 30_000 })
      .toBe('done');
    await first.client.page
      .frameLocator(MARKDOWN_FRAME)
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

  it('R3: обновление при смонтированном элементе в другом окне: введённый ответ и рамка целы, проверка идёт в новую версию, новые монтирования — с новыми файлами', async () => {
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
    const frame = first.client.page.locator(ANSWER_FRAME);
    await frame.evaluate((node) => Reflect.set(node, '__old', true));
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

    // элемент и ответ не тронуты
    expect(await frame.evaluate((node) => Reflect.get(node, '__old'))).toBe(
      true,
    );
    const input = first.client.page
      .frameLocator(ANSWER_FRAME)
      .locator('acme-echo-answer input');
    expect(await input.inputValue()).toBe('41');
    expect(
      await first.client.page
        .frameLocator(ANSWER_FRAME)
        .locator('acme-echo-answer[data-version]')
        .count(),
    ).toBe(0);
    await expectCount(first.catalog.page.getByTestId('extensions-reload'), 0);

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
      .frameLocator(ANSWER_FRAME)
      .locator('acme-echo-answer[data-version="1.1.0"]')
      .waitFor({ state: 'attached', timeout: 30_000 });
  });

  it('R7: элемент доверенного расширения уже определён в окне, обновление просит перезагрузку; после неё действует новая версия', async () => {
    server = await startCatalogServer([ECHO_1_1]);
    await seedCatalogInstall(workspace.userData, {
      id: 'acme.echo',
      dir: ECHO_1_0.dir,
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    const { client, catalog } = {
      client: new Client(app.page),
      catalog: new CatalogClient(app.page),
    };
    await client.openSettingsExtensions();
    await client.setExtensionSwitch('acme.echo', 'trusted', true);
    await expectCount(client.reloadBanner(), 0);

    // элемент определяется в окне: расширение доверенное, рамки нет
    await client.openCourses();
    await client.focusCourse(ECHO);
    await client.startSession();
    await client.answerElement('acme-echo-answer');
    expect(await client.page.locator('iframe').count()).toBe(0);
    await client.page
      .getByRole('button', { name: 'Выйти из сессии', exact: true })
      .click();
    const stillSameWindow = await client.markWindow();

    await client.openSettingsExtensions();
    await catalog.updateFromRow('acme.echo');
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await expectText(
      client.reloadBanner(),
      'Обновление применится после перезагрузки окна',
    );
    await stillSameWindow();

    // до перезагрузки определённый элемент прежний
    await client.openPlan();
    await client.startSession();
    const element = await client.answerElement('acme-echo-answer');
    expect(await element.getAttribute('data-version')).toBeNull();
    await client.page
      .getByRole('button', { name: 'Выйти из сессии', exact: true })
      .click();

    await client.openSettingsExtensions();
    await client.reloadFromBanner();
    await expectCount(client.reloadBanner(), 0);
    await client.openPlan();
    await client.startSession();
    const fresh = await client.answerElement('acme-echo-answer');
    expect(await fresh.getAttribute('data-version')).toBe('1.1.0');
  });

  it('R7: обновление без определённого в окне элемента, и недоверенного расширения, перезагрузки не просит', async () => {
    server = await startCatalogServer([ECHO_1_1]);
    await seedCatalogInstall(workspace.userData, {
      id: 'acme.echo',
      dir: ECHO_1_0.dir,
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    const client = new Client(app.page);
    const catalog = new CatalogClient(app.page);
    await client.openSettingsExtensions();
    // недоверенное: рамка, а не определение тега в окне
    await client.openCourses();
    await client.focusCourse(ECHO);
    await client.startSession();
    await client.answerElement('acme-echo-answer');
    await client.page
      .getByRole('button', { name: 'Выйти из сессии', exact: true })
      .click();

    await client.openSettingsExtensions();
    await catalog.updateFromRow('acme.echo');
    await catalog.confirmInstall();
    await catalog.closeDialog();
    expect(await catalog.installedText('acme.echo')).toContain(
      'Из каталога v1.1.0',
    );
    await expectCount(client.reloadBanner(), 0);
  });
});
