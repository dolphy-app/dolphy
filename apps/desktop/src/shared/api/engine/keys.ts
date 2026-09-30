import type { InjectionKey } from 'vue';
import type { LearningEngine } from '@lms/engine-contract';

export const ENGINE_KEY: InjectionKey<LearningEngine> = Symbol('engine');
