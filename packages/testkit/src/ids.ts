import type { IdGenerator } from '@spirula-app/engine';

export interface TestIds extends IdGenerator {
  /** Сколько идентификаторов выдано. */
  readonly issued: number;
}

/** Детерминированные идентификаторы `<prefix>-000001`, `<prefix>-000002`… */
export const createTestIds = (prefix = 'id'): TestIds => {
  let issued = 0;
  return {
    next: () => `${prefix}-${String(++issued).padStart(6, '0')}`,
    get issued() {
      return issued;
    },
  };
};
