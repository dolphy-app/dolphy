import { EMPTY_SERVER_REGISTRATION } from '@dolphy-app/extension-api';
import type { ServerContext as ApiContext } from '@dolphy-app/extension-api';
import { describe, expect, it, vi } from 'vitest';
import { messageOf, registrarOf, run } from './registrar-harness.ts';

const ID = 'acme.reg';

const schema = { type: 'object', properties: { n: { type: 'number' } } };

const exerciseType = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.quiz`,
  specSchema: schema,
  answerSchema: schema,
  project: run,
  grade: run,
  ...patch,
});

const policy = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.strict`,
  label: 'Strict',
  evaluate: run,
  ...patch,
});

describe('снимок', () => {
  it('пустой регистратор даёт пустую регистрацию', () => {
    expect(registrarOf(ID).registrar.snapshot()).toEqual(
      EMPTY_SERVER_REGISTRATION,
    );
  });

  it('содержит только сериализуемые данные, обработчиков в нём нет', () => {
    const { registrar, s } = registrarOf(ID);
    s.registerExerciseType(exerciseType({ referenceAnswer: run }) as never);
    s.registerGradePolicy(policy() as never);
    s.on('attempt.closed', () => {});
    s.registerCommand({ id: `${ID}.c`, title: 'C', run });

    expect(structuredClone(registrar.snapshot())).toEqual(registrar.snapshot());
  });

  it('снимок не меняется от последующих регистраций', () => {
    const { registrar, s } = registrarOf(ID);
    const before = registrar.snapshot();

    s.on('session.started', () => {});

    expect(before.events).toEqual([]);
    expect(registrar.snapshot().events).toEqual(['session.started']);
  });
});

describe('seal', () => {
  it.each([
    [
      'exercise type',
      (s: ApiContext) => s.registerExerciseType(exerciseType() as never),
    ],
    [
      'grade policy',
      (s: ApiContext) => s.registerGradePolicy(policy() as never),
    ],
    [
      'setting',
      (s: ApiContext) =>
        s.registerSettings([
          { id: `${ID}.a`, type: 'boolean', label: 'A', default: true },
        ]),
    ],
    ['event', (s: ApiContext) => s.on('attempt.closed', () => {})],
    [
      'command',
      (s: ApiContext) => s.registerCommand({ id: `${ID}.c`, title: 'C', run }),
    ],
    [
      'schedule',
      (s: ApiContext) =>
        s.schedule({ id: `${ID}.s`, every: 'hourly' }, () => {}),
    ],
    [
      'importer',
      (s: ApiContext) =>
        s.registerImporter({
          id: `${ID}.i`,
          title: 'I',
          accept: ['.csv'],
          input: 'text',
          run: run as never,
        }),
    ],
    [
      'exporter',
      (s: ApiContext) =>
        s.registerExporter({
          id: `${ID}.e`,
          title: 'E',
          scope: 'course',
          run: run as never,
        }),
    ],
  ])(
    'после seal регистрация (%s) бросает и ничего не добавляет',
    (kind, call) => {
      const { registrar, s } = registrarOf(ID);
      registrar.seal();

      expect(messageOf(() => call(s))).toContain(
        `${kind}: server() has already finished`,
      );
      expect(registrar.snapshot()).toEqual(EMPTY_SERVER_REGISTRATION);
    },
  );

  it('вклады, зарегистрированные до seal, остаются; dispose после seal работает', () => {
    const { registrar, s } = registrarOf(ID);
    s.registerCommand({ id: `${ID}.keep`, title: 'K', run });
    const handle = s.registerCommand({ id: `${ID}.drop`, title: 'D', run });
    registrar.seal();

    handle.dispose();

    expect(registrar.snapshot().commands.map(({ id }) => id)).toEqual([
      `${ID}.keep`,
    ]);
  });
});

describe('registerExerciseType', () => {
  it('нормализует: подпись null по умолчанию, схемы копируются, обработчики остаются в хосте', () => {
    const spec = structuredClone(schema);
    const { registrar, s } = registrarOf(ID);
    const reg = exerciseType({ specSchema: spec });

    s.registerExerciseType(reg as never);
    s.registerExerciseType(
      exerciseType({
        id: `${ID}.other`,
        title: { en: 'Other', ru: 'Другое' },
      }) as never,
    );
    spec.properties.n.type = 'string';

    const [first, second] = registrar.snapshot().exerciseTypes;
    expect(first).toEqual({
      id: `${ID}.quiz`,
      title: null,
      specSchema: schema,
      answerSchema: schema,
    });
    expect(second?.title).toEqual({ en: 'Other', ru: 'Другое' });
    expect(registrar.handlers.exerciseTypes.get(`${ID}.quiz`)?.handler).toBe(
      reg,
    );
  });

  it.each([
    ['пустая specSchema', exerciseType({ specSchema: {} }), 'specSchema'],
    ['пустая answerSchema', exerciseType({ answerSchema: {} }), 'answerSchema'],
    [
      'specSchema не объект',
      exerciseType({ specSchema: 'object' }),
      'specSchema',
    ],
    [
      'схема не компилируется',
      exerciseType({ specSchema: { type: 'no-such-type' } }),
      "specSchema of 'acme.reg.quiz' is not a valid JSON Schema",
    ],
    [
      'answerSchema не компилируется',
      exerciseType({ answerSchema: { properties: 5 } }),
      "answerSchema of 'acme.reg.quiz' is not a valid JSON Schema",
    ],
    ['нет project', exerciseType({ project: undefined }), 'project'],
    ['нет grade', exerciseType({ grade: undefined }), 'grade'],
    [
      'referenceAnswer не функция',
      exerciseType({ referenceAnswer: 'x' }),
      'referenceAnswer',
    ],
    ['пустая подпись', exerciseType({ title: '' }), 'title'],
    ['подпись 61 знак', exerciseType({ title: 'x'.repeat(61) }), 'title'],
    [
      'id вне пространства расширения',
      exerciseType({ id: 'other.quiz' }),
      "id must be 'acme.reg'",
    ],
    ['лишний ключ', exerciseType({ extra: 1 }), 'extra'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    const { registrar, s } = registrarOf(ID);

    expect(messageOf(() => s.registerExerciseType(entry as never))).toContain(
      fragment,
    );
    expect(registrar.snapshot().exerciseTypes).toEqual([]);
  });

  it('повтор id; Disposable освобождает id', () => {
    const { registrar, s } = registrarOf(ID);
    const handle = s.registerExerciseType(exerciseType() as never);

    expect(
      messageOf(() => s.registerExerciseType(exerciseType() as never)),
    ).toContain(`duplicate exercise type '${ID}.quiz'`);

    handle.dispose();
    expect(registrar.snapshot().exerciseTypes).toEqual([]);
    expect(() => s.registerExerciseType(exerciseType() as never)).not.toThrow();
  });
});

describe('registerGradePolicy', () => {
  it('нормализует: хранит id и подпись, evaluate остаётся в хосте', () => {
    const { registrar, s } = registrarOf(ID);
    const evaluate = vi.fn();

    s.registerGradePolicy(
      policy({ label: { en: 'Strict', ru: 'Строгая' }, evaluate }) as never,
    );

    expect(registrar.snapshot().gradePolicies).toEqual([
      { id: `${ID}.strict`, label: { en: 'Strict', ru: 'Строгая' } },
    ]);
    expect(registrar.handlers.gradePolicies.get(`${ID}.strict`)?.handler).toBe(
      evaluate,
    );
  });

  it('идентификатор встроенного правила passAtN занять нельзя', () => {
    const { registrar, s } = registrarOf('passAtN');

    expect(() =>
      s.registerGradePolicy(policy({ id: 'passAtN' }) as never),
    ).toThrow("id 'passAtN' is reserved for the built-in policy");
    expect(registrar.snapshot().gradePolicies).toEqual([]);
  });

  it.each([
    ['пустая подпись', policy({ label: '' }), 'label'],
    ['нет подписи', policy({ label: undefined }), 'label'],
    ['нет evaluate', policy({ evaluate: undefined }), 'evaluate'],
    [
      'id вне пространства расширения',
      policy({ id: 'other.strict' }),
      "id must be 'acme.reg'",
    ],
    ['лишний ключ', policy({ extra: 1 }), 'extra'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    const { s } = registrarOf(ID);

    expect(messageOf(() => s.registerGradePolicy(entry as never))).toContain(
      fragment,
    );
  });

  it('повтор id; Disposable убирает правило', () => {
    const { registrar, s } = registrarOf(ID);
    const handle = s.registerGradePolicy(policy() as never);

    expect(messageOf(() => s.registerGradePolicy(policy() as never))).toContain(
      `duplicate grade policy '${ID}.strict'`,
    );

    handle.dispose();
    expect(registrar.snapshot().gradePolicies).toEqual([]);
  });
});

describe('идентификаторы вкладов', () => {
  it.each([
    ['пустой', ''],
    ['с заглавной', `${ID}.Quiz`],
    ['с пробелом', `${ID}.a b`],
    ['длиннее 64 знаков', `${ID}.${'a'.repeat(64)}`],
  ])('форма id: %s — отклоняется', (_name, id) => {
    const { s } = registrarOf(ID);

    expect(() => s.registerGradePolicy(policy({ id }) as never)).toThrow();
  });

  it('id, совпадающий с id расширения, и вложенные допустимы; соседнее пространство — нет', () => {
    const { s } = registrarOf(ID);

    expect(() =>
      s.registerGradePolicy(policy({ id: ID }) as never),
    ).not.toThrow();
    expect(() =>
      s.registerGradePolicy(policy({ id: `${ID}.a.b` }) as never),
    ).not.toThrow();
    expect(
      messageOf(() =>
        s.registerGradePolicy(policy({ id: `${ID}x.a` }) as never),
      ),
    ).toContain(`id must be '${ID}'`);
  });

  it('один id в разных видах вкладов допустим', () => {
    const { s } = registrarOf(ID);

    expect(() => {
      s.registerGradePolicy(policy({ id: `${ID}.x` }) as never);
      s.registerExerciseType(exerciseType({ id: `${ID}.x` }) as never);
      s.registerCommand({ id: `${ID}.x`, title: 'X', run });
    }).not.toThrow();
  });
});

describe('on', () => {
  it('снимок хранит события в порядке подписки; обработчик остаётся в хосте', () => {
    const { registrar, s } = registrarOf(ID);
    const handler = vi.fn();

    s.on('attempt.closed', handler);
    s.on('session.started', () => {});

    expect(registrar.snapshot().events).toEqual([
      'attempt.closed',
      'session.started',
    ]);
    expect(registrar.handlers.events.get('attempt.closed')).toBe(handler);
  });

  it('неизвестное событие отклоняется', () => {
    const { s } = registrarOf(ID);

    expect(messageOf(() => s.on('attempt.opened' as never, () => {}))).toBe(
      "event 'attempt.opened': unknown learning event",
    );
  });

  it('повторная подписка на то же событие отклоняется', () => {
    const { s } = registrarOf(ID);
    s.on('attempt.closed', () => {});

    expect(messageOf(() => s.on('attempt.closed', () => {}))).toContain(
      'event is already subscribed',
    );
  });

  it('обработчик не функция отклоняется', () => {
    const { registrar, s } = registrarOf(ID);

    expect(messageOf(() => s.on('attempt.closed', 'x' as never))).toContain(
      'handler must be a function',
    );
    expect(registrar.snapshot().events).toEqual([]);
  });

  it('Disposable снимает подписку: событие уходит из снимка, подписаться можно снова', () => {
    const { registrar, s } = registrarOf(ID);
    const handle = s.on('attempt.closed', () => {});

    handle.dispose();

    expect(registrar.snapshot().events).toEqual([]);
    expect(registrar.handlers.events.size).toBe(0);
    expect(() => s.on('attempt.closed', () => {})).not.toThrow();
  });

  it('устаревший Disposable не снимает новую подписку', () => {
    const { registrar, s } = registrarOf(ID);
    const first = s.on('attempt.closed', () => {});
    first.dispose();
    s.on('attempt.closed', () => {});

    first.dispose();

    expect(registrar.snapshot().events).toEqual(['attempt.closed']);
  });
});
