import { readFileSync } from 'node:fs';

interface OffsetClockDeps {
  now(): number;
  read(file: string): string;
}

const nodeDeps: OffsetClockDeps = {
  now: Date.now,
  read: (file) => readFileSync(file, 'utf8'),
};

/**
 * Часы планировщика расписаний для e2e: системное время плюс смещение из
 * файла `file` (целое число мс, может быть отрицательным). Файл
 * перечитывается при каждом вызове, поэтому тест подводит часы к моменту
 * срабатывания, когда приложение уже готово, а не угадывает запас на его
 * старт. Нет файла или в нём не число — действует прежнее смещение (сначала 0).
 */
export const createOffsetClock = (
  file: string,
  deps: OffsetClockDeps = nodeDeps,
): (() => number) => {
  let offset = 0;
  return () => {
    try {
      const text = deps.read(file).trim();
      if (/^-?\d{1,15}$/.test(text)) offset = Number(text);
    } catch {
      // файла ещё нет: прежнее смещение
    }
    return deps.now() + offset;
  };
};
