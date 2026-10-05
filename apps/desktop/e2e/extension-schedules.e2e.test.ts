import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { readExtensionData } from './support/journal.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const dir = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const SCHEDULE_ID = 'acme.schedule';
const CONTROL_ID = 'acme.control';
/** Время срабатывания `daily` у фикстуры и час, к которому подводятся часы. */
const MOMENT = { hours: 9, minutes: 0 };
/** Сколько до момента на часах планировщика в начале запуска приложения, мс: запас на старт Electron и движка. */
const LEAD_MS = 15_000;
/** Запас сценариев, где тест успевает зайти в настройки до момента срабатывания. */
const LONG_LEAD_MS = 30_000;
const SCHEDULE_TEXT = 'Каждый день в 09:00 · Каждый час';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

/** Смещение часов планировщика, при котором сейчас — `LEAD_MS` до 09:00 по местному времени. */
const offsetToMoment = (leadMs = LEAD_MS): number => {
  const now = new Date();
  const target = new Date(now);
  target.setHours(MOMENT.hours, MOMENT.minutes, 0, 0);
  return target.getTime() - leadMs - now.getTime();
};

const launch = async (clockOffsetMs: number | null) => {
  await app?.close();
  app = await launchApp(workspace!.userData, {
    // тик каждые 100 мс вместо 30 с; часы сдвинуты так, чтобы до момента оставалось несколько секунд
    DOLPHY_SCHEDULE_TICK_MS: '100',
    ...(clockOffsetMs !== null && {
      DOLPHY_CLOCK_OFFSET_MS: String(clockOffsetMs),
    }),
  });
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return new Client(app.page);
};

const fired = (id: string): unknown =>
  readExtensionData(workspace!.userData, id).storage['fired'];

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
    await launch(offsetToMoment());
    // до момента расширения не активированы: данных нет
    expect(fired(SCHEDULE_ID)).toBeUndefined();

    await expect
      .poll(() => fired(SCHEDULE_ID), { timeout: LEAD_MS + 15_000 })
      .toEqual(expect.arrayContaining(['morning', 'hourly']));
    await expect
      .poll(() => fired(CONTROL_ID), { timeout: 10_000 })
      .toEqual(['hourly']);
    // тики идут дальше, а момент уже обработан
    await pause(1500);
    expect([...(fired(SCHEDULE_ID) as string[])].sort()).toEqual([
      'hourly',
      'morning',
    ]);
    expect(fired(CONTROL_ID)).toEqual(['hourly']);
  });

  it('срабатывание, найденное позже двух минут, пропускается и не воспроизводится', async () => {
    await prepare();
    // часы уже на 3 минуты позже момента: прошлое не воспроизводится, следующий час далеко
    await launch(offsetToMoment(-3 * 60_000));
    await pause(2500);
    expect(fired(SCHEDULE_ID)).toBeUndefined();
    expect(fired(CONTROL_ID)).toBeUndefined();
  });

  it('строка показывает расписания человеческим текстом и переключатель «Расписание»; выключенный переключатель переживает перезапуск и не пускает расписание, контрольное срабатывает', async () => {
    await prepare();
    let client = await launch(null);

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

    client = await launch(offsetToMoment(LONG_LEAD_MS));
    await client.openSettingsExtensions();
    expect(await client.extensionSwitchChecked(SCHEDULE_ID, 'schedules')).toBe(
      false,
    );
    await expect
      .poll(() => fired(CONTROL_ID), { timeout: LONG_LEAD_MS + 15_000 })
      .toEqual(['hourly']);
    expect(fired(SCHEDULE_ID)).toBeUndefined();
  });

  it('отключённое расширение не срабатывает: переключатель «Включено» действует сразу, без перезапуска', async () => {
    await prepare();
    const client = await launch(offsetToMoment(LONG_LEAD_MS));
    await client.openSettingsExtensions();
    await client.setExtensionSwitch(SCHEDULE_ID, 'enabled', false);

    await expect
      .poll(() => fired(CONTROL_ID), { timeout: LONG_LEAD_MS + 15_000 })
      .toEqual(['hourly']);
    expect(fired(SCHEDULE_ID)).toBeUndefined();
  });
});
