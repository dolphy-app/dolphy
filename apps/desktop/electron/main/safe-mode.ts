import type { SafeModeSource } from '@dolphy-app/engine-contract';

/** Флаг командной строки безопасного режима. */
export const SAFE_MODE_FLAG = '--safe-mode';

/** Переменная окружения безопасного режима: включает только значение `1`. */
export const SAFE_MODE_ENV = 'DOLPHY_SAFE_MODE';

/**
 * Чем безопасный режим задан при запуске: флагом (сильнее) или переменной
 * окружения; `undefined` — режим зависит только от настройки.
 */
export const safeModeSource = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): SafeModeSource | undefined => {
  if (argv.includes(SAFE_MODE_FLAG)) return 'flag';
  return env[SAFE_MODE_ENV] === '1' ? 'env' : undefined;
};
