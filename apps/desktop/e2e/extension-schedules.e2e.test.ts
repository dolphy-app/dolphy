import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { readExtensionData } from './support/journal.ts';
import { expectText } from './support/locator.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const dir = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const SCHEDULE_ID = 'acme.schedule';
const CONTROL_ID = 'acme.control';
const SCHEDULE_TEXT = 'Каждый день в 09:00 · Каждый час';
/** Период проверки планировщика в тестах, мс (по умолчанию 30 000). */
const TICK_MS = 100;
/** Срок, за который срабатывание доходит до расширения: тик, запуск ограниченного процесса и обработчик. */
const FIRING_TIMEOUT = 20_000;
/** Окно, в котором «не сработало» наблюдается: несколько десятков тиков при ускоренных часах. */
const QUIET_MS = 1500;

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

/** Местное время сегодняшнего дня, epoch ms. */
const today = (hours: number, minutes = 0, seconds = 0): number => {
  const date = new Date();
  date.setHours(hours, minutes, seconds, 0);
  return date.getTime();
};

const clockFile = (): string =>
  join(dirname(workspace!.userData), 'clock-offset');

/**
 * Ставит часы планировщика на местное время `at` (дальше они идут в реальном
 * темпе). Запись целиком и переименование: хост перечитывает файл на каждом
 * тике и не должен увидеть половину числа.
 */
const setClock = async (at: number): Promise<void> => {
  const file = clockFile();
  await writeFile(`${file}.tmp`, String(at - Date.now()));
  await rename(`${file}.tmp`, file);
};

/**
 * Запуск с часами, которые стоят за 50 минут до момента срабатывания (08:10):
 * пока тест не подведёт их сам, ни одно расписание не срабатывает, какой бы
 * медленной ни была загрузка. Возвращает клиента, когда приложение готово и
 * хост расширений подключён к движку: срабатывание, пришедшееся на отключённый
 * хост, теряется по замыслу, поэтому подведение часов раньше было бы гонкой.
 */
const launch = async () => {
  await app?.close();
  await setClock(today(8, 10));
  app = await launchApp(workspace!.userData, {
    DOLPHY_SCHEDULE_TICK_MS: String(TICK_MS),
    DOLPHY_CLOCK_OFFSET_FILE: clockFile(),
  });
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  // команда расширения отвечает, только когда запрос дошёл до хоста расширений (запрос ждёт подключения)
  const commands = new CommandsClient(app.page);
  await commands.openPalette();
  await commands.search('проверить связь');
  await commands.option('Проверить связь').waitFor({ timeout: 30_000 });
  await commands.combobox.press('Enter');
  await expectText(commands.notice, 'Связь есть');
  return new Client(app.page);
};

/** Сколько раз сработало расписание (`morning` / `hourly`); `undefined` — ни разу. */
const fired = (id: string, which: 'morning' | 'hourly'): unknown =>
  readExtensionData(workspace!.userData, id).storage[`fired.${which}`];

const pause = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const prepare = async () => {
  workspace = await createWorkspace({
    extensions: {
      [SCHEDULE_ID]: dir('schedule-extension'),
      [CONTROL_ID]: dir('schedule-control-extension'),
    },
    libraryFiles: PLAIN_LIBRARY,
  });
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('schedules', () => {
  it('в момент срабатывания расширение активируется и получает daily и hourly по одному разу; повтора нет', async () => {
    await prepare();
    await launch();
    // часы стоят до момента: расширение не активировано, данных нет
    expect(fired(SCHEDULE_ID, 'morning')).toBeUndefined();
    expect(fired(SCHEDULE_ID, 'hourly')).toBeUndefined();

    await setClock(today(9));
    await expect
      .poll(
        () => [fired(SCHEDULE_ID, 'morning'), fired(SCHEDULE_ID, 'hourly')],
        { timeout: FIRING_TIMEOUT },
      )
      .toEqual([1, 1]);
    await expect
      .poll(() => fired(CONTROL_ID, 'hourly'), { timeout: FIRING_TIMEOUT })
      .toBe(1);
    // тики идут дальше, а момент уже обработан
    await pause(QUIET_MS);
    expect([
      fired(SCHEDULE_ID, 'morning'),
      fired(SCHEDULE_ID, 'hourly'),
    ]).toEqual([1, 1]);
    expect(fired(CONTROL_ID, 'hourly')).toBe(1);
  });

  it('срабатывание, найденное позже двух минут, пропускается и не воспроизводится', async () => {
    await prepare();
    await launch();
    // 09:03: момент 09:00 найден через три минуты, прошлое не воспроизводится
    await setClock(today(9, 3));
    // следующие тики точно приняли первый скачок; при остановке хоста оба скачка сольются в одну проверку,
    // тогда тест лишь теряет охват, ложного провала нет
    await pause(TICK_MS * 5);
    // 10:00: ближайший час срабатывает, и это доказывает, что планировщик жив и дошёл до конца
    await setClock(today(10));
    await expect
      .poll(() => fired(CONTROL_ID, 'hourly'), { timeout: FIRING_TIMEOUT })
      .toBe(1);
    await expect
      .poll(() => fired(SCHEDULE_ID, 'hourly'), { timeout: FIRING_TIMEOUT })
      .toBe(1);
    // `daily` 09:00 пропущен, `hourly` 09:00 не повторился (был бы второй раз)
    await pause(QUIET_MS);
    expect(fired(SCHEDULE_ID, 'morning')).toBeUndefined();
    expect(fired(SCHEDULE_ID, 'hourly')).toBe(1);
    expect(fired(CONTROL_ID, 'hourly')).toBe(1);
  });

  it('строка показывает расписания человеческим текстом и переключатель «Расписание»; выключенный переключатель переживает перезапуск и не пускает расписание, контрольное срабатывает', async () => {
    await prepare();
    let client = await launch();

    await client.openSettingsExtensions();
    const [row] = await client.readExtensions(SCHEDULE_ID);
    expect(row).toContain('Расписание');
    expect(row).toContain(SCHEDULE_TEXT);
    expect(await client.extensionSwitchChecked(SCHEDULE_ID, 'schedules')).toBe(
      true,
    );

    await client.setExtensionSwitch(SCHEDULE_ID, 'schedules', false);
    expect(await client.extensionSwitchChecked(SCHEDULE_ID, 'schedules')).toBe(
      false,
    );

    client = await launch();
    await client.openSettingsExtensions();
    expect(await client.extensionSwitchChecked(SCHEDULE_ID, 'schedules')).toBe(
      false,
    );
    await setClock(today(9));
    await expect
      .poll(() => fired(CONTROL_ID, 'hourly'), { timeout: FIRING_TIMEOUT })
      .toBe(1);
    // расписания обоих расширений приходят в один тик: ждём, пока вторая доставка успела бы дойти
    await pause(QUIET_MS);
    expect(fired(SCHEDULE_ID, 'morning')).toBeUndefined();
    expect(fired(SCHEDULE_ID, 'hourly')).toBeUndefined();
  });

  it('отключённое расширение не срабатывает: переключатель «Включено» действует сразу, без перезапуска', async () => {
    await prepare();
    const client = await launch();
    await client.openSettingsExtensions();
    await client.setExtensionSwitch(SCHEDULE_ID, 'enabled', false);

    await setClock(today(9));
    await expect
      .poll(() => fired(CONTROL_ID, 'hourly'), { timeout: FIRING_TIMEOUT })
      .toBe(1);
    await pause(QUIET_MS);
    expect(fired(SCHEDULE_ID, 'morning')).toBeUndefined();
    expect(fired(SCHEDULE_ID, 'hourly')).toBeUndefined();
  });
});
