// Synthetic clean library (KB or JSON layout) with `engine` frontmatter. Dependencies form antichains, so the clean
// library has no redundant edges; every start lesson has a dependent, so there are no orphans.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

export interface GenOptions {
  out: string;
  lessons: number;
  exercises: number;
  courses: number;
  layout: 'kb' | 'json';
  seed: number;
}
export interface GenResult {
  lessons: number;
  exercises: number;
  files: number;
  bytes: number;
  edges: number;
  ms: number;
}

/** Seeded xorshift32. */
export function rng(seed: number): () => number {
  let s = seed | 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export const BLOCK = 50;

export interface SynthPlan {
  cid: (c: number) => string;
  lid: (i: number) => string;
  short: (i: number) => string;
  deps: number[][];
  perCourse: number;
}

/** Deterministic dependency plan shared by generator and defect injector. */
export function plan(
  opts: Pick<GenOptions, 'lessons' | 'courses' | 'seed'>,
): SynthPlan {
  const r = rng(opts.seed);
  const perCourse = Math.ceil(opts.lessons / opts.courses);
  const cid = (c: number) => `syn::c${String(c).padStart(2, '0')}`;
  const short = (i: number) => `l${String(i).padStart(5, '0')}`;
  const lid = (i: number) => `${cid(Math.floor(i / perCourse))}::${short(i)}`;
  const deps: number[][] = [];
  const reach: Array<Set<number>> = [];
  for (let i = 0; i < opts.lessons; i++) {
    const start = i - (i % BLOCK);
    const d: number[] = [];
    if (
      i === start ||
      Math.floor(i / perCourse) !== Math.floor(start / perCourse)
    ) {
      // block start (or a block cut by a course boundary): no prerequisites
    } else if (i === start + 1) d.push(start);
    else {
      const want = 1 + Math.floor(r() * 3);
      for (let tries = 0; tries < 30 && d.length < want; tries++) {
        const j = Math.max(start, i - 1 - Math.floor(r() * 12));
        if (j >= i || d.includes(j)) continue;
        if (d.some((x) => reach[x]!.has(j) || reach[j]!.has(x))) continue;
        d.push(j);
      }
      if (d.length === 0) d.push(i - 1);
    }
    const rs = new Set<number>();
    for (const x of d) {
      rs.add(x);
      for (const y of reach[x]!) rs.add(y);
    }
    reach.push(rs);
    deps.push(d.sort((a, b) => a - b));
  }
  return { cid, lid, short, deps, perCourse };
}

export function frontFor(
  i: number,
  e: number,
  keys: string[],
  layoutId: string,
  crlf: boolean,
  requires: boolean,
  r: number,
): string {
  const verify = requires || r < 0.6;
  const lines: string[] = ['---', 'engine:'];
  if (verify) {
    lines.push(
      '  exercise:',
      '    type: lms.sql',
      '    timeoutMs: 2000',
      '    spec:',
      `      fixture: "fixtures/${layoutId}.sql"`,
      `      expected: sql/${layoutId}_e${e}.csv`,
      '      orderSensitive: false',
    );
  }
  if (keys.length > 0) lines.push(`  keyPrerequisites: [${keys.join(', ')}]`);
  lines.push(
    `  tags: [topic${i % 17}, "level: ${i % 3}"]`,
    `  bloom: ${['remember', 'understand', 'apply', 'analyze'][e % 4]}`,
    `  dok: ${1 + (e % 3)}`,
    '---',
  );
  lines.push(
    `What is the answer to question ${e} of lesson ${i}? Ответ: ${(i * 7 + e) % 97}, 日本語.`,
    '',
    '```sql',
    'SELECT 1;',
    '```',
    '',
  );
  return lines.join(crlf ? '\r\n' : '\n');
}

export function generateLibrary(opts: GenOptions): GenResult {
  const t0 = performance.now();
  rmSync(opts.out, { recursive: true, force: true });
  mkdirSync(opts.out, { recursive: true });
  const p = plan(opts);
  const r = rng(opts.seed ^ 0x5bd1e995);
  let files = 0,
    bytes = 0,
    edges = 0,
    exercises = 0;
  const write = (path: string, text: string) => {
    writeFileSync(path, text);
    files++;
    bytes += text.length;
  };
  const json = (path: string, v: unknown) =>
    write(path, JSON.stringify(v, null, 2));
  const kb = opts.layout === 'kb';
  for (let c = 0; c < opts.courses; c++) {
    const dir = `${opts.out}/c${String(c).padStart(2, '0')}`;
    mkdirSync(dir, { recursive: true });
    const requires = c < Math.min(10, opts.courses);
    json(`${dir}/course_manifest.json`, {
      id: p.cid(c),
      name: `Synthetic course ${c}`,
      dependencies: c > 0 && c % 5 === 0 ? [p.cid(c - 1)] : [],
      ...(kb ? { generator_config: { KnowledgeBase: {} } } : {}),
      engine: { requiresChecks: requires, tags: ['synthetic'] },
    });
    for (
      let i = c * p.perCourse;
      i < Math.min(opts.lessons, (c + 1) * p.perCourse);
      i++
    ) {
      const ld = `${dir}/${p.short(i)}${kb ? '.lesson' : ''}`;
      mkdirSync(ld);
      const deps = p.deps[i]!;
      edges += deps.length;
      const enc: Array<[string, number]> =
        i % 10 === 3 && deps.length > 0 ? [[p.lid(deps[0]!), 0.5]] : [];
      const sup: string[] =
        i % 20 === 7 && i > 0 && Math.floor((i - 1) / p.perCourse) === c
          ? [p.lid(i - 1)]
          : [];
      const mkKeys = (): string[] =>
        // an ancestor lesson (direct dependency) as key prerequisite for ~20% of exercises
        deps.length > 0 && r() < 0.2
          ? [p.lid(deps[Math.floor(r() * deps.length)]!)]
          : [];
      if (kb) {
        const short = (id: string) =>
          id.startsWith(`${p.cid(c)}::`) ? id.slice(p.cid(c).length + 2) : id;
        if (deps.length)
          json(
            `${ld}/lesson.dependencies.json`,
            deps.map((d) => short(p.lid(d))),
          );
        if (enc.length)
          json(
            `${ld}/lesson.encompassed.json`,
            enc.map(([id, w]) => [short(id), w]),
          );
        if (sup.length) json(`${ld}/lesson.superseded.json`, sup.map(short));
        json(`${ld}/lesson.name.json`, `Lesson ${i}`);
        if (i % 5 === 1)
          write(
            `${ld}/lesson.material.md`,
            `# Lesson ${i}\n\nSome material.\n`,
          );
        if (i % 20 === 5)
          json(`${ld}/lesson.engine.json`, {
            tags: ['core'],
            bloom: 'understand',
            dok: 2,
          });
        for (let e = 0; e < opts.exercises; e++) {
          write(
            `${ld}/e${e}.front.md`,
            frontFor(
              i,
              e,
              mkKeys(),
              p.short(i),
              (i + e) % 20 === 0,
              requires,
              r(),
            ),
          );
          write(`${ld}/e${e}.back.md`, `The answer is ${(i * 7 + e) % 97}.\n`);
          exercises++;
        }
      } else {
        const lesson: Record<string, unknown> = {
          id: p.lid(i),
          course_id: p.cid(c),
          name: `Lesson ${i}`,
          dependencies: deps.map(p.lid),
          encompassed: enc,
          superseded: sup,
        };
        if (i % 20 === 5)
          lesson.engine = { tags: ['core'], bloom: 'understand', dok: 2 };
        if (i % 5 === 1) {
          lesson.lesson_material = {
            MarkdownAsset: { path: 'lesson.material.md' },
          };
          write(
            `${ld}/lesson.material.md`,
            `# Lesson ${i}\n\nSome material.\n`,
          );
        }
        json(`${ld}/lesson_manifest.json`, lesson);
        for (let e = 0; e < opts.exercises; e++) {
          const ed = `${ld}/e${e}`;
          mkdirSync(ed);
          json(`${ed}/exercise_manifest.json`, {
            id: `${p.lid(i)}::e${e}`,
            lesson_id: p.lid(i),
            course_id: p.cid(c),
            name: `Exercise ${e}`,
            exercise_type: e % 2 ? 'Declarative' : 'Procedural',
            exercise_asset: {
              FlashcardAsset: { front_path: 'front.md', back_path: 'back.md' },
            },
          });
          write(
            `${ed}/front.md`,
            frontFor(
              i,
              e,
              mkKeys(),
              p.short(i),
              (i + e) % 20 === 0,
              requires,
              r(),
            ),
          );
          write(`${ed}/back.md`, `The answer is ${(i * 7 + e) % 97}.\n`);
          exercises++;
        }
      }
    }
  }
  return {
    lessons: opts.lessons,
    exercises,
    files,
    bytes,
    edges,
    ms: performance.now() - t0,
  };
}
