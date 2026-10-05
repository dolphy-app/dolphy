import type { EngineConfig } from '@dolphy-app/engine-contract';

/** Нижняя граница периода проверки расписаний, мс: чаще опрашивать незачем. */
const MIN_TICK_MS = 10;

const wholeNumber = (value: string | undefined): number | undefined =>
  value !== undefined && /^-?\d{1,15}$/.test(value) ? Number(value) : undefined;

/**
 * Ускоренные часы расписаний для e2e: `DOLPHY_SCHEDULE_TICK_MS` — период
 * проверки, `DOLPHY_CLOCK_OFFSET_FILE` — путь к файлу со смещением часов
 * планировщика относительно системных (целое число мс, может быть
 * отрицательным; хост перечитывает его на каждом тике). Неверное значение
 * игнорируется; в собранном приложении ничего не действует.
 */
export const scheduleClockOf = (
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): Pick<EngineConfig, 'scheduleTickMs' | 'scheduleClockOffsetFile'> => {
  if (packaged) return {};
  const tick = wholeNumber(env.DOLPHY_SCHEDULE_TICK_MS);
  const file = env.DOLPHY_CLOCK_OFFSET_FILE;
  return {
    ...(tick !== undefined && tick >= MIN_TICK_MS && { scheduleTickMs: tick }),
    ...(file !== undefined && file !== '' && { scheduleClockOffsetFile: file }),
  };
};
