import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import { catalogEnv, startCatalogServer } from './support/catalog-server.ts';
import type { CatalogServer } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import { readExtensionData, readJournal } from './support/journal.ts';
import {
  PLAIN_COURSE,
  PLAIN_LIBRARY,
  STATE_COURSE,
  STATE_ID,
  STATE_LIBRARY,
  StateClient,
} from './support/state-client.ts';

const STATE_EXTENSION = fileURLToPath(
  new URL('./fixtures/state-extension', import.meta.url),
);
const LIBRARY = { ...STATE_LIBRARY, ...PLAIN_LIBRARY };
const PERMISSION_LABEL = 'События обучения';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let server: CatalogServer | null = null;

interface Session {
  client: Client;
  state: StateClient;
  catalog: CatalogClient;
}

const launch = async (
  userData: string,
  env?: Record<string, string>,
): Promise<Session> => {
  await app?.close();
  app = await launchApp(userData, env);
  const client = new Client(app.page);
  return {
    client,
    state: new StateClient(client),
    catalog: new CatalogClient(app.page),
  };
};

const prepare = async (options: { extension?: boolean } = {}) => {
  workspace = await createWorkspace({
    ...(options.extension !== false && {
      extensions: { [STATE_ID]: STATE_EXTENSION },
    }),
    libraryFiles: LIBRARY,
  });
  return launch(workspace.userData);
};

/** Данные расширения в `engine.db` (приложение может быть запущено). */
const data = () => readExtensionData(workspace!.userData, STATE_ID);

const startStateSession = async ({ client }: Session, focus = true) => {
  if (focus) {
    await client.openCourses();
    await client.focusCourse(STATE_COURSE);
  } else {
    await client.openPlan();
  }
  await client.startSession();
};

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
});

describe('настройки расширения', () => {
  it('диалог «Настройки»: значения доходят до работающего расширения без перезагрузки; отказы движка видны; «Сбросить» возвращает умолчания', async () => {
    const session = await prepare();
    const { client, state } = session;
    await startStateSession(session);
    const first = await state.report();
    expect(first).toMatchObject({
      greeting: 'привет',
      loud: false,
      limit: 3,
      mode: 'calm',
      activations: 1,
      changes: 0,
    });
    await state.leaveSession();

    await client.openSettingsExtensions();
    const stillSameWindow = await client.markWindow();
    await state.openSettings();
    expect(await state.settingText('greeting')).toBe('привет');
    // пустая строка по умолчанию остаётся пустой (а не приводится к «true»)
    expect(await state.settingText('note')).toBe('');
    expect(await state.fieldMessage('greeting')).toContain(
      'Что расширение пишет в отчёте',
    );
    expect(await state.fieldMessage('limit')).toContain('От 1 до 10');

    await state.typeSetting('greeting', 'пока');
    await state.setLoud(true);
    await state.typeSetting('limit', '5');
    await state.chooseMode('Бодрый');
    await expect
      .poll(() => data().settings, { timeout: 10_000 })
      .toEqual({
        'acme.state.greeting': 'пока',
        'acme.state.loud': true,
        'acme.state.limit': 5,
        'acme.state.mode': 'brisk',
      });
    expect(await state.modeText()).toBe('Бодрый');

    // движок отклоняет неверные значения, и причина видна под полем
    await state.typeSetting('limit', '99');
    await expect
      .poll(() => state.fieldMessage('limit'))
      .toContain('Число вне допустимых границ.');
    await state.typeSetting('greeting', 'слишком-длинное-приветствие');
    await expect
      .poll(() => state.fieldMessage('greeting'))
      .toContain('Значение слишком длинное.');
    await state.typeSetting('limit', '');
    await expect
      .poll(() => state.fieldMessage('limit'))
      .toContain('Введите число.');
    expect(data().settings).toMatchObject({
      'acme.state.greeting': 'пока',
      'acme.state.limit': 5,
    });
    // исправленный ввод снимает ошибки
    await state.typeSetting('limit', '6');
    await state.typeSetting('greeting', 'пока');
    await expect
      .poll(() => state.fieldMessage('limit'))
      .toContain('От 1 до 10');
    await expect
      .poll(() => state.fieldMessage('greeting'))
      .toContain('Что расширение пишет в отчёте');
    await state.closeSettings();

    await client.openPlan();
    await client.startSession();
    const second = await state.report();
    expect(second).toMatchObject({
      greeting: 'пока',
      loud: true,
      limit: 6,
      mode: 'brisk',
      // расширение не перезапускалось: активация одна, изменения дошли подпиской
      activations: 1,
      changes: 5,
    });
    await state.leaveSession();

    await client.openSettingsExtensions();
    await state.openSettings();
    await state.resetSettings();
    await expect.poll(() => state.settingText('greeting')).toBe('привет');
    expect(await state.settingText('limit')).toBe('3');
    expect(await state.isLoud()).toBe(false);
    expect(await state.modeText()).toBe('Спокойный');
    await expect.poll(() => data().settings).toEqual({});
    await state.closeSettings();

    await client.openPlan();
    await client.startSession();
    expect(await state.report()).toMatchObject({
      greeting: 'привет',
      loud: false,
      limit: 3,
      mode: 'calm',
      activations: 1,
      changes: 9,
    });
    await stillSameWindow();
  });

  it('у отключённого расширения нет кнопки «Настройки»', async () => {
    const { client, state } = await prepare();
    await client.openSettingsExtensions();
    await expect
      .poll(() => state.page.getByTestId(`settings-${STATE_ID}`).count())
      .toBe(1);
    await client.setExtensionSwitch(STATE_ID, 'enabled', false);
    await expect
      .poll(() => state.page.getByTestId(`settings-${STATE_ID}`).count())
      .toBe(0);
    await client.setExtensionSwitch(STATE_ID, 'enabled', true);
    await expect
      .poll(() => state.page.getByTestId(`settings-${STATE_ID}`).count())
      .toBe(1);
  });
});

describe.each([
  ['изолированный режим (по умолчанию)', false],
  ['«Доверять» включено', true],
])('события обучения и хранилище: %s', (_name, trusted) => {
  it('attempt.closed приходит ровно один раз на попытку, session.* — по одному на сессию; счётчик переживает перезапуск', async () => {
    const first = await prepare();
    const { client, state } = first;
    if (trusted) {
      await client.openSettingsExtensions();
      await client.setExtensionSwitch(STATE_ID, 'trusted', true);
    }
    await startStateSession(first);
    const opened = await state.reportUntil(({ started }) => started === 1);
    expect(opened).toMatchObject({ closed: 0, finished: 0, activations: 1 });

    await state.passAndAdvance();
    const afterOne = await state.reportUntil(({ closed }) => closed >= 1);
    expect(afterOne.closed).toBe(1);
    expect(afterOne.last).toMatchObject({ outcome: 'passed' });
    expect(afterOne.last?.grade).toBeGreaterThanOrEqual(3);

    await state.passAndAdvance();
    const afterTwo = await state.reportUntil(({ closed }) => closed >= 2);
    // дубликатов нет: две закрытые попытки — два события
    expect(afterTwo.closed).toBe(2);
    await state.leaveSession();
    expect(data().storage).toMatchObject({ closed: 2, started: 1 });
    expect(data().storage['finished']).toBeUndefined();
    expect(readJournal(workspace!.userData)).toHaveLength(2);

    const { client: again, state: stateAgain } = await launch(
      workspace!.userData,
    );
    await again.openPlan();
    expect(await again.planTotal()).toBeGreaterThan(0);
    await again.startSession();
    const restarted = await stateAgain.reportUntil(
      ({ started }) => started === 2,
    );
    // данные пережили перезапуск; расширение активировалось второй раз
    expect(restarted).toMatchObject({
      closed: 2,
      finished: 0,
      activations: 2,
    });
    // «Завершить» зовёт окно: движок отправляет session.finished
    const closedNow = await stateAgain.passUntilFinished();
    const total = 2 + closedNow;
    await expect
      .poll(() => data().storage, { timeout: 15_000 })
      .toMatchObject({
        closed: total,
        started: 2,
        finished: 1,
        activations: 2,
      });
    expect(readJournal(workspace!.userData)).toHaveLength(total);
  });
});

describe('события и отключение', () => {
  it('отключённое расширение событий не получает, накопленное не доставляется после включения', async () => {
    const session = await prepare();
    const { client, state } = session;
    await startStateSession(session);
    await state.reportUntil(({ started }) => started === 1);
    await state.passAndAdvance();
    await state.reportUntil(({ closed }) => closed === 1);
    await state.leaveSession();

    await client.openSettingsExtensions();
    await client.setExtensionSwitch(STATE_ID, 'enabled', false);
    await expect
      .poll(async () => (await client.readExtensions(STATE_ID))[0])
      .toContain('Отключено');

    // обычное занятие по другому курсу: попытка и сессия закрываются без расширения
    await client.openCourses();
    await client.focusCourse(PLAIN_COURSE);
    await client.startSession();
    await client.runSession(() => 5);
    await client.backToPlan();
    expect(readJournal(workspace!.userData)).toHaveLength(2);

    await client.openSettingsExtensions();
    await client.setExtensionSwitch(STATE_ID, 'enabled', true);
    await client.openCourses();
    await client.focusCourse(STATE_COURSE);
    await client.startSession();
    const report = await state.reportUntil(({ started }) => started >= 2);
    // пропущенные события не придут задним числом: сессия «Plain» не учтена
    expect(report).toMatchObject({ started: 2, closed: 1, finished: 0 });
    expect(data().storage).toMatchObject({ started: 2, closed: 1 });
  });
});

describe('жизненный цикл данных', () => {
  it('«Очистить данные»: строка «Данные» исчезает, работающее расширение видит пустое хранилище и настройки по умолчанию', async () => {
    const session = await prepare();
    const { client, state } = session;
    await startStateSession(session);
    await state.reportUntil(({ started }) => started === 1);
    await state.passAndAdvance();
    await state.reportUntil(({ closed }) => closed >= 1);
    await state.leaveSession();

    await client.openSettingsExtensions();
    expect(await state.dataLine()).toMatch(/^4 ключа, /);
    await state.openSettings();
    await state.typeSetting('greeting', 'пока');
    await expect
      .poll(() => data().settings)
      .toEqual({ 'acme.state.greeting': 'пока' });
    await state.closeSettings();
    await expect.poll(() => state.dataLine()).toMatch(/^5 ключей, /);

    await state.clearData();
    await expect.poll(() => state.dataLine()).toBeNull();
    expect(data()).toEqual({ storage: {}, settings: {} });

    await client.openPlan();
    await client.startSession();
    const report = await state.report();
    expect(report).toMatchObject({
      closed: 0,
      activations: 0,
      greeting: 'привет',
    });
  });

  it('у расширения без данных строки «Данные» нет', async () => {
    const { client, state } = await prepare();
    await client.openSettingsExtensions();
    await client.readExtensions(STATE_ID);
    expect(await state.dataLine()).toBeNull();
  });

  it('превышение потолка значения бросает StorageQuotaError в расширении; запись не происходит, остальные данные и события целы', async () => {
    const session = await prepare();
    const { state } = session;
    await startStateSession(session);
    await state.reportUntil(({ started }) => started === 1);
    const report = await state.report('quota');
    expect(report).toMatchObject({
      quota: 'StorageQuotaError',
      quotaKind: 'value-size',
      quotaLimit: 65536,
    });
    expect(data().storage['big']).toBeUndefined();

    await state.passAndAdvance();
    await state.reportUntil(({ closed }) => closed >= 1);
    expect(data().storage).toMatchObject({ closed: 1, started: 1 });
  });
});

describe('установка из каталога и удаление', () => {
  it('разрешение и точки видны при установке, в каталоге и в списке; удаление сохраняет данные или стирает их по флажку', async () => {
    server = await startCatalogServer([
      {
        dir: STATE_EXTENSION,
        name: 'State',
        description: 'Расширение с состоянием',
        author: 'acme',
      },
    ]);
    workspace = await createWorkspace({ libraryFiles: LIBRARY });
    const { client, state, catalog } = await launch(
      workspace.userData,
      catalogEnv(server.url),
    );
    await client.openSettingsExtensions();

    await catalog.openCatalogTab();
    const card = await catalog.catalogCard(STATE_ID).innerText();
    expect(card).toContain(PERMISSION_LABEL);
    expect(card).toContain('Настройки');
    await catalog.installButton(STATE_ID).click();
    expect(await catalog.dialog.innerText()).toContain(PERMISSION_LABEL);
    await catalog.confirmInstall();
    await catalog.closeDialog();

    await catalog.openInstalledTab();
    const row = await catalog.installedText(STATE_ID);
    expect(row).toContain(PERMISSION_LABEL);
    expect(row).toContain('Настройки:');
    expect(row).toContain('События обучения:');

    await state.openSettings();
    await state.typeSetting('greeting', 'пока');
    await expect
      .poll(() => data().settings)
      .toEqual({ 'acme.state.greeting': 'пока' });
    await state.closeSettings();
    await expect.poll(() => state.dataLine()).toMatch(/^1 ключ, /);

    // по умолчанию данные остаются
    await state.openRemove();
    expect(
      await state.page
        .getByRole('dialog')
        .getByRole('checkbox', { name: 'Удалить данные расширения' })
        .isChecked(),
    ).toBe(false);
    await state.confirmRemove();
    expect(data().settings).toEqual({ 'acme.state.greeting': 'пока' });

    await catalog.openCatalogTab();
    await catalog.installButton(STATE_ID).click();
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await catalog.openInstalledTab();
    await expect.poll(() => state.dataLine()).toMatch(/^1 ключ, /);
    await state.openSettings();
    expect(await state.settingText('greeting')).toBe('пока');
    await state.closeSettings();

    // с флажком данные стираются вместе с расширением
    await state.openRemove();
    await state.tickRemoveData(true);
    await state.confirmRemove();
    await expect.poll(() => data()).toEqual({ storage: {}, settings: {} });

    await catalog.openCatalogTab();
    await catalog.installButton(STATE_ID).click();
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await catalog.openInstalledTab();
    expect(await state.dataLine()).toBeNull();
    await state.openSettings();
    expect(await state.settingText('greeting')).toBe('привет');
  });
});
