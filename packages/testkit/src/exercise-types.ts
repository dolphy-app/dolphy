import type {
  ExerciseTypeInfo,
  ExerciseTypes,
  RawVerdict,
} from '@dolphy-app/engine/ports';

export interface FakeTypeOptions {
  element?: string;
  /** Сообщения `validateSpec`; по умолчанию `[]`. */
  specErrors?: string[];
  /** Сообщения `validateAnswer`; по умолчанию `[]`. */
  answerErrors?: string[];
  /** Результат `project`; по умолчанию `{}`. */
  project?: unknown;
  /** Вердикты `grade` по порядку вызовов. */
  script?: (RawVerdict | Promise<RawVerdict>)[];
  /** Эталонный ответ; нет — `referenceAnswer` отвечает `found: false`. */
  reference?: unknown;
}

export interface FakeGradeRequest {
  type: string;
  exerciseId: string;
  spec: unknown;
  answer: unknown;
  timeoutMs: number;
  authorMode: boolean;
}

export interface FakeExerciseTypes extends ExerciseTypes {
  readonly requests: FakeGradeRequest[];
  closed: boolean;
}

/** Виды заданий по сценарию; каждый вызов `grade` сохраняется в `requests`. */
export const createFakeExerciseTypes = (
  options: { types?: Record<string, FakeTypeOptions> } = {},
): FakeExerciseTypes => {
  const types = new Map(Object.entries(options.types ?? {}));
  const queues = new Map(
    [...types].map(([type, { script }]) => [type, [...(script ?? [])]]),
  );
  const infoOf = (type: string): ExerciseTypeInfo | undefined => {
    const fake = types.get(type);
    return fake === undefined
      ? undefined
      : {
          type,
          extensionId: type,
          extensionVersion: '0.0.0',
          extensionOrigin: 'user',
          extensionRevision: 'rev-0',
          element: fake.element ?? `fake-${type.replaceAll('.', '-')}`,
          rendererUrl: `dolphy-ext://fake/${type}.mjs`,
        };
  };
  const requests: FakeGradeRequest[] = [];
  const fake: FakeExerciseTypes = {
    requests,
    closed: false,
    describe: infoOf,
    list: () =>
      [...types.keys()].map((type) => infoOf(type) as ExerciseTypeInfo),
    validateSpec: (type) =>
      types.has(type)
        ? (types.get(type)?.specErrors ?? [])
        : ['unknown exercise type'],
    validateAnswer: (type) =>
      types.has(type)
        ? (types.get(type)?.answerErrors ?? [])
        : ['unknown exercise type'],
    project: async ({ type }) => types.get(type)?.project ?? {},
    grade: async (request) => {
      requests.push(request);
      const next = queues.get(request.type)?.shift();
      if (next === undefined) throw new Error('script is exhausted');
      return next;
    },
    referenceAnswer: async ({ type }) => {
      const reference = types.get(type)?.reference;
      return reference === undefined
        ? { found: false }
        : { found: true, answer: reference };
    },
    close: async () => {
      fake.closed = true;
    },
  };
  return fake;
};
