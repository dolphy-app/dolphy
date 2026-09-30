import { inject } from 'vue';
import type { LearningEngine } from '@spirula/engine-contract';
import { ENGINE_KEY } from './keys.ts';

export const useEngine = (): LearningEngine => {
  const engine = inject(ENGINE_KEY);
  if (!engine) throw new Error('engine is not provided');
  return engine;
};
