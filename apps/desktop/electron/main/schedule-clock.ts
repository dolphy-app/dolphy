import type { EngineConfig } from '@dolphy-app/engine-contract';

/** Нижняя граница периода проверки расписаний, мс: чаще опрашивать незачем. */
const MIN_TICK_MS = 10;

const wholeNumber = (value: string | undefined): number | undefined =>
  value !== undefined && /^-?\d{1,15}$/.test(value) ? Number(value) : undefined;

/**
 * Ускоренные часы расписаний для e2e: `DOLPHY_SCHEDULE_TICK_MS` — период
 * проверки, `DOLPHY_CLOCK_OFFSET_MS` — смещение часов планировщика
 * относительно системных (целое, может быть отрицательным). Неверное
 * значение игнорируется; в собранном приложении ничего не действует.
 */
export const scheduleClockOf = (
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): Pick<EngineConfig, 'scheduleTickMs' | 'scheduleClockOffsetMs'> => {
  if (packaged) return {};
  const tick = wholeNumber(env.DOLPHY_SCHEDULE_TICK_MS);
  const offset = wholeNumber(env.DOLPHY_CLOCK_OFFSET_MS);
  return {
    ...(tick !== undefined && tick >= MIN_TICK_MS && { scheduleTickMs: tick }),
    ...(offset !== undefined && { scheduleClockOffsetMs: offset }),
  };
};
