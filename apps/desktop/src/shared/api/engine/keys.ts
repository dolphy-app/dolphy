import type { InjectionKey } from 'vue';
import type {
  ContributionsDto,
  LearningEngine,
} from '@spirula/engine-contract';

export const ENGINE_KEY: InjectionKey<LearningEngine> = Symbol('engine');
export const CONTRIBUTIONS_KEY: InjectionKey<ContributionsDto> =
  Symbol('contributions');
