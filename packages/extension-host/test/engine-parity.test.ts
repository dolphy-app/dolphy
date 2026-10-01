import { EXTENSION_STORAGE_LIMITS as ENGINE_LIMITS } from '@dolphy-app/engine';
import { LEARNING_EVENT_NAMES as ENGINE_EVENTS } from '@dolphy-app/engine-contract';
import type {
  LearningEventName as EngineEventName,
  LearningEventPayloads as EnginePayloads,
} from '@dolphy-app/engine-contract';
import {
  EXTENSION_STORAGE_LIMITS,
  LEARNING_EVENT_NAMES,
} from '@dolphy-app/extension-api';
import type {
  LearningEventName,
  LearningEventPayloads,
} from '@dolphy-app/extension-api';
import { describe, expect, expectTypeOf, it } from 'vitest';

// extension-api не зависит от движка и дублирует его типы и числа: расхождение ломает автора расширения
describe('extension-api совпадает с контрактом движка', () => {
  it('потолки хранилища', () => {
    expect(EXTENSION_STORAGE_LIMITS).toEqual(ENGINE_LIMITS);
  });

  it('имена событий обучения', () => {
    expect([...LEARNING_EVENT_NAMES]).toEqual([...ENGINE_EVENTS]);
    expectTypeOf<LearningEventName>().toEqualTypeOf<EngineEventName>();
  });

  it('поля событий обучения', () => {
    expectTypeOf<LearningEventPayloads>().toEqualTypeOf<EnginePayloads>();
  });
});
