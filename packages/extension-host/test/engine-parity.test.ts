import { EXTENSION_STORAGE_LIMITS as ENGINE_LIMITS } from '@dolphy-app/engine';
import { COURSE_SNAPSHOT_LIMITS } from '@dolphy-app/engine/app';
import {
  LEARNING_EVENT_NAMES as ENGINE_EVENTS,
  MAX_EXTENSION_TRANSFER_BYTES,
} from '@dolphy-app/engine-contract';
import type {
  LearningEventName as EngineEventName,
  LearningEventPayloads as EnginePayloads,
} from '@dolphy-app/engine-contract';
import {
  EXTENSION_STORAGE_LIMITS,
  EXTENSION_TRANSFER_LIMITS,
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

  it('потолки импорта и экспорта', () => {
    expect(MAX_EXTENSION_TRANSFER_BYTES).toBe(
      EXTENSION_TRANSFER_LIMITS.inputBytes,
    );
    expect(MAX_EXTENSION_TRANSFER_BYTES).toBe(
      EXTENSION_TRANSFER_LIMITS.totalBytes,
    );
    expect(COURSE_SNAPSHOT_LIMITS).toEqual({
      files: EXTENSION_TRANSFER_LIMITS.files,
      totalBytes: EXTENSION_TRANSFER_LIMITS.totalBytes,
      pathBytes: EXTENSION_TRANSFER_LIMITS.pathBytes,
    });
  });

  it('имена событий обучения', () => {
    expect([...LEARNING_EVENT_NAMES]).toEqual([...ENGINE_EVENTS]);
    expectTypeOf<LearningEventName>().toEqualTypeOf<EngineEventName>();
  });

  it('поля событий обучения', () => {
    expectTypeOf<LearningEventPayloads>().toEqualTypeOf<EnginePayloads>();
  });
});
