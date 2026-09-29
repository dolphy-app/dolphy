import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CLASS_KNOWN,
  CLASS_UNCERTAIN,
  CLASS_UNKNOWN,
  buildTopicGraph,
  createDiagnosticSession,
  frontierOf,
  runDiagnostic,
  topicClassName,
} from '../../src/placement/index.ts';
import type {
  DiagnosticConfig,
  TopicGraph,
} from '../../src/placement/index.ts';
import {
  isDownset,
  layeredDag,
  mulberry32,
  randomDownset,
  trueFrontier,
} from './helpers.ts';

const configArb = fc.record({
  minPass: fc.constantFrom(0, 2),
  seed: fc.integer({ min: 0, max: 1000 }),
});
const dagArb = fc.record({
  size: fc.integer({ min: 2, max: 40 }),
  width: fc.integer({ min: 1, max: 8 }),
  seed: fc.integer({ min: 0, max: 1000 }),
});
const build = (d: { size: number; width: number; seed: number }) =>
  layeredDag(d.size, d.width, mulberry32(d.seed));

const collect = (
  session: ReturnType<typeof createDiagnosticSession>,
  answerOf: (k: number) => boolean,
) => {
  for (
    let k = 0, t = session.nextProbe();
    t !== null;
    t = session.nextProbe()
  ) {
    session.answer(t, answerOf(k++));
  }
  return { probes: [...session.probes], classes: [...session.classes()] };
};

describe('свойства сессии (T-45)', () => {
  it('p ∈ [0,1]; проход не понижает, провал не повышает p; без повторов; бюджет', () => {
    fc.assert(
      fc.property(
        dagArb,
        configArb,
        fc.array(fc.boolean(), { minLength: 60, maxLength: 60 }),
        fc.integer({ min: 1, max: 30 }),
        (d, c, answers, budget) => {
          const graph = build(d);
          const session = createDiagnosticSession(graph, { ...c, budget });
          const seen = new Set<number>();
          for (let k = 0; ; k++) {
            const u = session.nextProbe();
            if (u === null) break;
            expect(seen.has(u)).toBe(false);
            seen.add(u);
            const before = Array.from({ length: graph.size }, (_, i) =>
              session.probability(i),
            );
            const pass = answers[k % answers.length] as boolean;
            session.answer(u, pass);
            for (let i = 0; i < graph.size; i++) {
              const p = session.probability(i);
              expect(p >= 0 && p <= 1 && Number.isFinite(p)).toBe(true);
              if (pass)
                expect(p).toBeGreaterThanOrEqual((before[i] as number) - 1e-12);
              else expect(p).toBeLessThanOrEqual((before[i] as number) + 1e-12);
            }
          }
          expect(session.probes.length).toBeLessThanOrEqual(budget);
          expect(session.probes.length).toBeLessThanOrEqual(graph.size);
          expect(() => session.answer(session.probes[0] ?? 0, true)).toThrow();
        },
      ),
      { numRuns: 60, seed: 4501 },
    );
  });

  it('детерминизм: (seed, ответы) → те же пробы; счётчик unresolved = число uncertain', () => {
    fc.assert(
      fc.property(
        dagArb,
        configArb,
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        (d, c, answers) => {
          const graph = build(d);
          const run = () => {
            const session = createDiagnosticSession(graph, {
              ...c,
              budget: 25,
            });
            const result = collect(
              session,
              (k) => answers[k % answers.length] as boolean,
            );
            expect(session.unresolvedCount).toBe(
              result.classes.filter((x) => x === CLASS_UNCERTAIN).length,
            );
            return result;
          };
          expect(run()).toEqual(run());
        },
      ),
      { numRuns: 40, seed: 4502 },
    );
  });

  it('безшумные ответы по случайному downset не противоречат истине; фронтир = истинный', () => {
    fc.assert(
      fc.property(
        dagArb,
        configArb,
        fc.integer({ min: 0, max: 1e6 }),
        (d, c, tseed) => {
          const graph = build(d);
          const truth = randomDownset(graph, mulberry32(tseed), 20);
          expect(isDownset(graph, truth)).toBe(true);
          const session = createDiagnosticSession(graph, {
            ...c,
            budget: graph.size,
          });
          const classes = runDiagnostic(session, (u) => truth[u] === 1);
          for (let u = 0; u < graph.size; u++) {
            if (classes[u] === CLASS_KNOWN) expect(truth[u]).toBe(1);
            if (classes[u] === CLASS_UNKNOWN) expect(truth[u]).toBe(0);
          }
          if (c.minPass === 0) {
            expect(frontierOf(graph, classes)).toEqual(
              trueFrontier(graph, truth),
            );
          }
        },
      ),
      { numRuns: 80, seed: 4503 },
    );
  });

  it('цепочка из 32 тем без шума решается ≤ 7 пробами', () => {
    const n = 32;
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);
    const graph = buildTopicGraph(ids, (id) => {
      const i = Number(id.slice(1));
      return i === 0 ? [] : [`c${i - 1}`];
    });
    const truth = Uint8Array.from({ length: n }, (_, i) => (i < 13 ? 1 : 0));
    const session = createDiagnosticSession(graph, { budget: n, seed: 3 });
    const classes = runDiagnostic(session, (u) => truth[u] === 1);
    expect([...classes]).toEqual(
      [...truth].map((t) => (t === 1 ? CLASS_KNOWN : CLASS_UNKNOWN)),
    );
    expect(session.probes.length).toBeLessThanOrEqual(7);
  });
});

describe('устройство сессии', () => {
  const chainEdges: Record<string, string[]> = { a: [], b: ['a'], c: ['b'] };
  const chain = buildTopicGraph(['a', 'b', 'c'], (id) => chainEdges[id]);

  it('проход повышает предков (жёсткое замыкание), провал понижает потомков', () => {
    const passed = createDiagnosticSession(chain, { budget: 5, seed: 1 });
    passed.answer(2, true);
    expect([...passed.classes()]).toEqual([
      CLASS_KNOWN,
      CLASS_KNOWN,
      CLASS_KNOWN,
    ]);
    const failed = createDiagnosticSession(chain, { budget: 5, seed: 1 });
    failed.answer(0, false);
    expect([...failed.classes()]).toEqual([
      CLASS_UNKNOWN,
      CLASS_UNKNOWN,
      CLASS_UNKNOWN,
    ]);
    expect(topicClassName(CLASS_UNCERTAIN)).toBe('uncertain');
  });

  it('minPass: known только после нужного числа независимых проходов', () => {
    const session = createDiagnosticSession(chain, {
      budget: 5,
      seed: 1,
      minPass: 2,
    });
    session.answer(1, true); // a: один проход (через замыкание), b: один
    expect(session.classOf(0)).toBe(CLASS_UNCERTAIN);
    expect(session.classOf(1)).toBe(CLASS_UNCERTAIN);
    session.answer(2, true); // a и b получили второй проход
    expect(session.classOf(0)).toBe(CLASS_KNOWN);
    expect(session.classOf(1)).toBe(CLASS_KNOWN);
  });

  it('ошибки: повторный ответ, неизвестная тема, guess/slip вне (0,1)', () => {
    const session = createDiagnosticSession(chain, { budget: 5, seed: 1 });
    session.answer(1, true);
    expect(() => session.answer(1, false)).toThrow(/already probed/);
    expect(() => session.answer(3, true)).toThrow(RangeError);
    expect(() => session.answer(-1, true)).toThrow(RangeError);
    expect(() => session.answer(0.5, true)).toThrow(RangeError);
    for (const bad of [
      { guess: 0 },
      { slip: 1 },
    ] as Partial<DiagnosticConfig>[]) {
      expect(() =>
        createDiagnosticSession(chain, { budget: 1, seed: 1, ...bad }),
      ).toThrow(RangeError);
    }
  });

  it('нулевой бюджет и пустой граф: проб нет', () => {
    expect(
      createDiagnosticSession(chain, { budget: 0, seed: 1 }).nextProbe(),
    ).toBeNull();
    const empty = buildTopicGraph([], () => undefined);
    expect(
      createDiagnosticSession(empty, { budget: 5, seed: 1 }).nextProbe(),
    ).toBeNull();
  });
});

describe('инварианты последовательности проб', () => {
  it('избыточное (транзитивно выводимое) ребро не меняет последовательность проб', () => {
    fc.assert(
      fc.property(
        dagArb,
        configArb,
        fc.integer({ min: 0, max: 1e6 }),
        (d, c, tseed) => {
          const base = build(d);
          // расширенные пререквизиты: прямые + все транзитивные предки
          const ancestors: Set<number>[] = Array.from(
            { length: base.size },
            () => new Set(),
          );
          for (const u of base.order) {
            for (const p of base.upTargets.subarray(
              base.upOffsets[u],
              base.upOffsets[u + 1],
            )) {
              ancestors[u]?.add(p);
              for (const a of ancestors[p] ?? []) ancestors[u]?.add(a);
            }
          }
          const withEdges = buildTopicGraph(base.ids, (id) => {
            const u = base.ids.indexOf(id);
            const direct = [
              ...base.upTargets.subarray(
                base.upOffsets[u],
                base.upOffsets[u + 1],
              ),
            ];
            const implied = [...(ancestors[u] ?? [])].filter(
              (a) => !direct.includes(a),
            );
            return [...direct, ...implied].map((p) => base.ids[p] as string);
          });
          expect(withEdges.rawEdges).toBeGreaterThanOrEqual(base.keptEdges);
          expect([...withEdges.upTargets]).toEqual([...base.upTargets]);
          expect([...withEdges.upOffsets]).toEqual([...base.upOffsets]);
          const truth = randomDownset(base, mulberry32(tseed), 20);
          const run = (graph: TopicGraph) => {
            const session = createDiagnosticSession(graph, {
              ...c,
              budget: 30,
            });
            runDiagnostic(session, (u) => truth[u] === 1);
            return [...session.probes];
          };
          expect(run(withEdges)).toEqual(run(base));
        },
      ),
      { numRuns: 40, seed: 4504 },
    );
  });

  it('повторные nextProbe без ответа возвращают ту же тему и не сдвигают дальнейшую последовательность', () => {
    fc.assert(
      fc.property(
        dagArb,
        configArb,
        fc.integer({ min: 0, max: 1e6 }),
        (d, c, tseed) => {
          const graph = build(d);
          const truth = randomDownset(graph, mulberry32(tseed), 20);
          const once = createDiagnosticSession(graph, { ...c, budget: 30 });
          const repeated = createDiagnosticSession(graph, { ...c, budget: 30 });
          runDiagnostic(once, (u) => truth[u] === 1);
          for (
            let t = repeated.nextProbe();
            t !== null;
            t = repeated.nextProbe()
          ) {
            for (let again = 0; again < 3; again++)
              expect(repeated.nextProbe()).toBe(t);
            repeated.answer(t, truth[t] === 1);
          }
          expect([...repeated.probes]).toEqual([...once.probes]);
          expect([...repeated.classes()]).toEqual([...once.classes()]);
        },
      ),
      { numRuns: 40, seed: 4505 },
    );
  });
});
