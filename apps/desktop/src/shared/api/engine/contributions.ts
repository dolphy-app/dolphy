import { inject } from 'vue';
import type {
  ContributionsDto,
  LearningEngine,
} from '@spirula-app/engine-contract';
import { CONTRIBUTIONS_KEY } from './keys.ts';

export const NO_CONTRIBUTIONS: ContributionsDto = {
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

/**
 * Вклады расширений читаются один раз при запуске (перезагрузка окна
 * обновляет их). Сбой чтения не мешает запуску: приложение работает без
 * вкладов, причина уходит в консоль.
 */
export const loadContributions = async (
  engine: LearningEngine,
): Promise<ContributionsDto> => {
  try {
    return await engine.extensions.contributions();
  } catch (error) {
    console.error({ error }, 'extension contributions were not loaded');
    return NO_CONTRIBUTIONS;
  }
};

export const useContributions = (): ContributionsDto =>
  inject(CONTRIBUTIONS_KEY, NO_CONTRIBUTIONS);
