import { describe, expect, it } from 'vitest';
import {
  convertToFullIds,
  filterMatchingExercises,
  generateKnowledgeBaseCourse,
  openKbLesson,
  parseKbFileName,
  toExerciseManifest,
  toLessonManifest,
} from '../../src/authoring/knowledge-base.ts';
import type {
  KbExercise,
  KbLesson,
} from '../../src/authoring/knowledge-base.ts';
import { scan } from '../../src/authoring/scan.ts';
import type { SourceEntry } from '../../src/ports/index.ts';
import {
  asJson,
  memoryFiles,
  onlyCode,
  readerFor,
} from '../helpers/scan-source.ts';

const file = (name: string): SourceEntry => ({ name, kind: 'file' });

const kbLesson = (fields: Partial<KbLesson> = {}): KbLesson => ({
  courseId: 'c',
  shortId: 'l',
  id: 'c::l',
  dir: 'c/l.lesson',
  dependencies: [],
  superseded: [],
  encompassed: [],
  name: null,
  description: null,
  metadata: null,
  defaultExerciseType: null,
  hasMaterial: false,
  hasInstructions: false,
  fields: {},
  ...fields,
});

const kbExercise = (fields: Partial<KbExercise> = {}): KbExercise => ({
  shortId: 'ex1',
  front: file('ex1.front.md'),
  back: null,
  name: null,
  description: null,
  type: null,
  fields: {},
  ...fields,
});

describe('parseKbFileName (to_knowledge_base_file)', () => {
  it.each([
    ['lesson.dependencies.json', { kind: 'lesson', which: 'dependencies' }],
    ['lesson.superseded.json', { kind: 'lesson', which: 'superseded' }],
    ['lesson.encompassed.json', { kind: 'lesson', which: 'encompassed' }],
    ['lesson.name.json', { kind: 'lesson', which: 'name' }],
    ['lesson.description.json', { kind: 'lesson', which: 'description' }],
    ['lesson.metadata.json', { kind: 'lesson', which: 'metadata' }],
    ['lesson.material.md', { kind: 'lesson', which: 'material' }],
    ['lesson.instructions.md', { kind: 'lesson', which: 'instructions' }],
    [
      'lesson.default_exercise_type.json',
      { kind: 'lesson', which: 'default_exercise_type' },
    ],
    ['lesson.engine.json', { kind: 'lesson', which: 'engine' }],
    ['ex1.front.md', { kind: 'exercise', id: 'ex1', part: 'front' }],
    ['ex1.back.md', { kind: 'exercise', id: 'ex1', part: 'back' }],
    ['ex1.name.json', { kind: 'exercise', id: 'ex1', part: 'name' }],
    [
      'ex1.description.json',
      { kind: 'exercise', id: 'ex1', part: 'description' },
    ],
    ['ex1.type.json', { kind: 'exercise', id: 'ex1', part: 'type' }],
    // точные имена раньше суффиксов: `lesson.front.md` — упражнение `lesson`
    ['lesson.front.md', { kind: 'exercise', id: 'lesson', part: 'front' }],
    ['lesson.type.json', { kind: 'exercise', id: 'lesson', part: 'type' }],
    ['x.y.front.md', { kind: 'exercise', id: 'x.y', part: 'front' }],
    ['.front.md', { kind: 'exercise', id: '', part: 'front' }],
    ['ex1', null],
    ['front.md', null],
    ['notes.txt', null],
    ['intro.lesson', null],
    ['ex1.front.md.bak', null],
  ])('%s', (name, expected) => {
    expect(parseKbFileName(name)).toEqual(expected);
  });
});

describe('convertToFullIds', () => {
  it('короткие id уроков курса становятся полными, чужие остаются', () => {
    const [first, second] = convertToFullIds('course1', [
      kbLesson({
        shortId: 'lesson1',
        dependencies: ['lesson2', 'other::lesson1'],
        superseded: ['lesson2'],
        encompassed: [
          ['lesson2', 0.5],
          ['other::lesson1', 1],
        ],
      }),
      kbLesson({ shortId: 'lesson2' }),
    ]);
    expect(first?.dependencies).toEqual(['course1::lesson2', 'other::lesson1']);
    expect(first?.superseded).toEqual(['course1::lesson2']);
    expect(first?.encompassed).toEqual([
      ['course1::lesson2', 0.5],
      ['other::lesson1', 1],
    ]);
    expect(second?.dependencies).toEqual([]);
  });

  it('id, совпавший с коротким id урока, всегда превращается в id этого курса', () => {
    const [advanced] = convertToFullIds('c', [
      kbLesson({ shortId: 'advanced', dependencies: ['intro'] }),
      kbLesson({ shortId: 'intro' }),
    ]);
    expect(advanced?.dependencies).toEqual(['c::intro']);
  });

  it('не мутирует вход', () => {
    const input = kbLesson({ shortId: 'a', dependencies: ['a'] });
    convertToFullIds('c', [input]);
    expect(input.dependencies).toEqual(['a']);
  });
});

describe('filterMatchingExercises', () => {
  it('упражнение без front отбрасывается, front без back остаётся', () => {
    const { kept, stray } = filterMatchingExercises(
      new Map([
        ['both', { front: file('both.front.md'), back: file('both.back.md') }],
        ['front-only', { front: file('front-only.front.md') }],
        ['back-only', { back: file('back-only.back.md') }],
        ['meta-only', { name: file('meta-only.name.json') }],
      ]),
    );
    expect([...kept.keys()]).toEqual(['both', 'front-only']);
    expect(
      stray.map(({ id, reason, file: f }) => [id, reason, f.name]),
    ).toEqual([
      ['back-only', 'no-front', 'back-only.back.md'],
      ['meta-only', 'no-front', 'meta-only.name.json'],
    ]);
  });

  it('пустой id отбрасывается даже с front', () => {
    const { kept, stray } = filterMatchingExercises(
      new Map([['', { front: file('.front.md') }]]),
    );
    expect(kept.size).toBe(0);
    expect(stray).toEqual([
      { id: '', reason: 'empty-id', file: file('.front.md') },
    ]);
  });
});

describe('openKbLesson', () => {
  it('читает JSON-файл урока (open_knowledge_base_file)', async () => {
    const { reader, diagnostics } = readerFor({
      'c/lesson1.lesson/lesson.dependencies.json': '["lesson0"]',
    });
    const opened = await openKbLesson(
      reader,
      'c',
      'lesson1',
      'c/lesson1.lesson',
    );
    expect(opened?.lesson.dependencies).toEqual(['lesson0']);
    expect(diagnostics).toEqual([]);
  });

  it('битый JSON — E_JSON_PARSE с файлом, строкой и юнитом; урок остаётся', async () => {
    const { reader, diagnostics } = readerFor({
      'c/l.lesson/lesson.name.json': '{\n  "a" 1}',
      'c/l.lesson/lesson.description.json': '"ok"',
    });
    const opened = await openKbLesson(reader, 'c', 'l', 'c/l.lesson');
    expect(opened?.lesson.name).toBeNull();
    expect(opened?.lesson.description).toBe('ok');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'E_JSON_PARSE',
      path: 'c/l.lesson/lesson.name.json',
      line: 2,
      unitId: 'c::l',
    });
  });

  it('нечитаемый файл (отказ readText) — E_IO с путём файла', async () => {
    const { reader, diagnostics } = readerFor(
      { 'c/l.lesson/lesson.name.json': '"Name"' },
      { unreadable: ['c/l.lesson/lesson.name.json'] },
    );
    const opened = await openKbLesson(reader, 'c', 'l', 'c/l.lesson');
    expect(opened?.lesson.name).toBeNull();
    expect(diagnostics.map(({ code, path }) => [code, path])).toEqual([
      ['E_IO', 'c/l.lesson/lesson.name.json'],
    ]);
  });

  it('тип поля не по схеме — E_SCHEMA', async () => {
    const { reader, diagnostics } = readerFor({
      'c/l.lesson/lesson.name.json': '1',
      'c/l.lesson/lesson.default_exercise_type.json': '"Weird"',
    });
    const opened = await openKbLesson(reader, 'c', 'l', 'c/l.lesson');
    expect(opened?.lesson.name).toBeNull();
    expect(opened?.lesson.defaultExerciseType).toBeNull();
    expect(
      diagnostics.map(({ code, path, unitId }) => [code, path, unitId]),
    ).toEqual([
      ['E_SCHEMA', 'c/l.lesson/lesson.name.json', 'c::l'],
      ['E_SCHEMA', 'c/l.lesson/lesson.default_exercise_type.json', 'c::l'],
    ]);
  });

  it('полный каталог урока: все файлы разобраны (open_lesson_dir)', async () => {
    const { reader, diagnostics } = readerFor({
      'c/lesson1.lesson/lesson.dependencies.json': '["a"]',
      'c/lesson1.lesson/lesson.superseded.json': '["b"]',
      'c/lesson1.lesson/lesson.encompassed.json': '[["c", 0.25]]',
      'c/lesson1.lesson/lesson.name.json': '"Lesson One"',
      'c/lesson1.lesson/lesson.description.json': '"About"',
      'c/lesson1.lesson/lesson.metadata.json': '{"k": ["v1", "v2"]}',
      'c/lesson1.lesson/lesson.material.md': 'material',
      'c/lesson1.lesson/lesson.instructions.md': 'instructions',
      'c/lesson1.lesson/lesson.default_exercise_type.json': '"Declarative"',
      'c/lesson1.lesson/ex1.front.md': 'front',
      'c/lesson1.lesson/ex1.back.md': 'back',
      'c/lesson1.lesson/ex1.name.json': '"Ex One"',
      'c/lesson1.lesson/ex1.description.json': '"Ex about"',
      'c/lesson1.lesson/ex1.type.json': '"Procedural"',
    });
    const opened = await openKbLesson(
      reader,
      'c',
      'lesson1',
      'c/lesson1.lesson',
    );
    expect(diagnostics).toEqual([]);
    expect(opened?.lesson).toMatchObject({
      id: 'c::lesson1',
      dependencies: ['a'],
      superseded: ['b'],
      encompassed: [['c', 0.25]],
      name: 'Lesson One',
      description: 'About',
      metadata: { k: ['v1', 'v2'] },
      defaultExerciseType: 'Declarative',
      hasMaterial: true,
      hasInstructions: true,
    });
    expect(opened?.exercises).toHaveLength(1);
    expect(opened?.exercises[0]).toMatchObject({
      shortId: 'ex1',
      front: { name: 'ex1.front.md' },
      back: { name: 'ex1.back.md' },
      name: 'Ex One',
      description: 'Ex about',
      type: 'Procedural',
    });
  });

  it('битые метаданные упражнения — E_JSON_PARSE юнита упражнения, имя по умолчанию', async () => {
    const { reader, diagnostics } = readerFor({
      'c/l.lesson/ex1.front.md': 'front',
      'c/l.lesson/ex1.name.json': 'not json',
    });
    const opened = await openKbLesson(reader, 'c', 'l', 'c/l.lesson');
    expect(diagnostics[0]).toMatchObject({
      code: 'E_JSON_PARSE',
      path: 'c/l.lesson/ex1.name.json',
      unitId: 'c::l::ex1',
    });
    const manifest = await toExerciseManifest(
      reader,
      opened!.lesson,
      opened!.exercises[0]!,
      false,
    );
    expect(manifest.name).toBe('Exercise ex1');
  });

  it('незнакомые файлы — W_KB_STRAY_FILE, точечные молча', async () => {
    const { reader, diagnostics } = readerFor({
      'c/l.lesson/notes.txt': 'x',
      'c/l.lesson/.DS_Store': 'x',
      'c/l.lesson/b.back.md': 'x',
      'c/l.lesson/.front.md': 'x',
      'c/l.lesson/sub/inner.txt': 'x',
      'c/l.lesson/ok.front.md': 'x',
    });
    await openKbLesson(reader, 'c', 'l', 'c/l.lesson');
    expect(onlyCode(diagnostics, 'W_KB_STRAY_FILE').map((d) => d.path)).toEqual(
      [
        'c/l.lesson/notes.txt',
        'c/l.lesson/sub',
        'c/l.lesson/.front.md',
        'c/l.lesson/b.back.md',
      ],
    );
    expect(diagnostics).toHaveLength(4);
  });

  it('нечитаемый каталог урока — E_IO', async () => {
    const { reader, diagnostics } = readerFor({});
    expect(await openKbLesson(reader, 'c', 'l', 'c/l.lesson')).toBeNull();
    expect(diagnostics.map(({ code, path }) => [code, path])).toEqual([
      ['E_IO', 'c/l.lesson'],
    ]);
  });

  it('lesson.engine.json: валидный engine и ошибка схемы', async () => {
    const good = readerFor({
      'c/l.lesson/lesson.engine.json': '{"tags": ["a"], "dok": 2}',
    });
    const opened = await openKbLesson(good.reader, 'c', 'l', 'c/l.lesson');
    expect(opened?.lesson.engine).toEqual({ tags: ['a'], dok: 2 });
    expect(opened?.lesson.engineSrc).toEqual({
      path: 'c/l.lesson/lesson.engine.json',
      line: 1,
    });

    const bad = readerFor({
      'c/l.lesson/lesson.engine.json': '{"dok": 9, "frobnicate": 1}',
    });
    const broken = await openKbLesson(bad.reader, 'c', 'l', 'c/l.lesson');
    expect(broken?.lesson.engine).toBeUndefined();
    expect(bad.diagnostics.map((d) => d.code).sort()).toEqual([
      'E_ENGINE_SCHEMA',
      'W_ENGINE_UNKNOWN_KEY',
    ]);
  });
});

describe('toLessonManifest (lesson_to_manifest)', () => {
  it('id, флаги превращаются в MarkdownAsset от корня библиотеки', () => {
    expect(
      toLessonManifest(
        kbLesson({
          courseId: 'course',
          shortId: 'x',
          id: 'course::x',
          dir: 'a/b/x.lesson',
          dependencies: ['course::y'],
          name: 'X',
          hasMaterial: true,
          hasInstructions: true,
          metadata: { k: ['v'] },
        }),
      ),
    ).toEqual({
      id: 'course::x',
      dependencies: ['course::y'],
      encompassed: [],
      superseded: [],
      course_id: 'course',
      name: 'X',
      description: null,
      metadata: { k: ['v'] },
      lesson_material: {
        MarkdownAsset: { path: 'a/b/x.lesson/lesson.material.md' },
      },
      lesson_instructions: {
        MarkdownAsset: { path: 'a/b/x.lesson/lesson.instructions.md' },
      },
    });
  });

  it('имя по умолчанию `Lesson <short>`, без флагов ассеты null', () => {
    const manifest = toLessonManifest(kbLesson({ shortId: 'q', id: 'c::q' }));
    expect(manifest.name).toBe('Lesson q');
    expect(manifest.lesson_material).toBeNull();
    expect(manifest.lesson_instructions).toBeNull();
  });
});

describe('toExerciseManifest', () => {
  it('inlined = false: FlashcardAsset с путями от корня (exercise_to_manifest)', async () => {
    const { reader } = readerFor({});
    const manifest = await toExerciseManifest(
      reader,
      kbLesson(),
      kbExercise({
        back: file('ex1.back.md'),
        name: 'Card',
        description: 'About',
      }),
      false,
    );
    expect(manifest).toEqual({
      id: 'c::l::ex1',
      lesson_id: 'c::l',
      course_id: 'c',
      name: 'Card',
      description: 'About',
      exercise_type: 'Procedural',
      exercise_asset: {
        FlashcardAsset: {
          front_path: 'c/l.lesson/ex1.front.md',
          back_path: 'c/l.lesson/ex1.back.md',
        },
      },
    });
  });

  it('без back: back_path null', async () => {
    const { reader } = readerFor({});
    const manifest = await toExerciseManifest(
      reader,
      kbLesson({ dir: 'l.lesson' }),
      kbExercise(),
      false,
    );
    expect(manifest.exercise_asset).toEqual({
      FlashcardAsset: { front_path: 'l.lesson/ex1.front.md', back_path: null },
    });
  });

  it('inlined = true читает содержимое дословно, без trim (…_inlined)', async () => {
    const { reader, diagnostics } = readerFor({
      'c/l.lesson/ex1.front.md': '  Q front \n\n',
      'c/l.lesson/ex1.back.md': 'Q back\r\n',
    });
    const manifest = await toExerciseManifest(
      reader,
      kbLesson(),
      kbExercise({ back: file('ex1.back.md') }),
      true,
    );
    expect(manifest.exercise_asset).toEqual({
      InlineFlashcardAsset: {
        front_content: '  Q front \n\n',
        back_content: 'Q back\r\n',
      },
    });
    expect(diagnostics).toEqual([]);
  });

  it('inlined, front нет — E_IO (…_inlined_missing_front)', async () => {
    const { reader, diagnostics } = readerFor({});
    await toExerciseManifest(reader, kbLesson(), kbExercise(), true);
    expect(
      diagnostics.map(({ code, path, unitId }) => [code, path, unitId]),
    ).toEqual([['E_IO', 'c/l.lesson/ex1.front.md', 'c::l::ex1']]);
  });

  it('inlined, `ex1.back.md` — каталог: E_IO (manifests_with_invalid_back_file)', async () => {
    const { reader, diagnostics } = readerFor({
      'c/l.lesson/ex1.front.md': 'front',
      'c/l.lesson/ex1.back.md/inner.txt': 'x',
    });
    const manifest = await toExerciseManifest(
      reader,
      kbLesson(),
      kbExercise({ back: { name: 'ex1.back.md', kind: 'directory' } }),
      true,
    );
    expect(diagnostics.map(({ code, path }) => [code, path])).toEqual([
      ['E_IO', 'c/l.lesson/ex1.back.md'],
    ]);
    expect(manifest.exercise_asset).toEqual({
      InlineFlashcardAsset: { front_content: 'front', back_content: null },
    });
  });

  it.each([
    [
      'файл упражнения важнее умолчания урока',
      'Declarative',
      'Procedural',
      'Declarative',
    ],
    ['умолчание урока важнее Procedural', null, 'Declarative', 'Declarative'],
    ['без указаний — Procedural', null, null, 'Procedural'],
    [
      'явный Procedural при умолчании Declarative',
      'Procedural',
      'Declarative',
      'Procedural',
    ],
  ] as const)('тип: %s', async (_name, own, byDefault, expected) => {
    const { reader } = readerFor({});
    const manifest = await toExerciseManifest(
      reader,
      kbLesson({ defaultExerciseType: byDefault }),
      kbExercise({ type: own }),
      false,
    );
    expect(manifest.exercise_type).toBe(expected);
  });
});

const D5_FILES: Record<string, string> = {
  'kb_course/course_manifest.json': JSON.stringify({
    id: 'kb',
    name: 'KB Course',
    generator_config: { KnowledgeBase: {} },
    course_instructions: { MarkdownAsset: { path: 'course.instructions.md' } },
  }),
  'kb_course/course.instructions.md': 'course instructions',
  'kb_course/intro.lesson/lesson.name.json': '"Introduction"',
  'kb_course/intro.lesson/lesson.instructions.md': 'instructions',
  'kb_course/intro.lesson/lesson.default_exercise_type.json': '"Declarative"',
  'kb_course/intro.lesson/a.front.md': 'A front',
  'kb_course/intro.lesson/a.back.md': 'A back',
  'kb_course/intro.lesson/a.name.json': '"First card"',
  'kb_course/intro.lesson/a.description.json': '"About A"',
  'kb_course/intro.lesson/b.front.md': 'B front',
  'kb_course/intro.lesson/c.back.md': 'C back',
  'kb_course/intro.lesson/d.front.md': 'D front',
  'kb_course/intro.lesson/d.type.json': '"Procedural"',
  'kb_course/intro.lesson/.front.md': 'empty id',
  'kb_course/intro.lesson/notes.txt': 'notes',
  'kb_course/advanced.lesson/lesson.dependencies.json': '["intro", "other::x"]',
  'kb_course/advanced.lesson/lesson.encompassed.json': '[["intro", 0.5]]',
  'kb_course/advanced.lesson/lesson.superseded.json': '["intro"]',
  'kb_course/advanced.lesson/lesson.metadata.json': '{"topic": ["adv"]}',
  'kb_course/advanced.lesson/e1.front.md': 'E1 front',
  'kb_course/advanced.lesson/e1.back.md': 'E1 back',
  'kb_course/plain.notlesson/x.front.md': 'ignored',
  'kb_inl/course_manifest.json': JSON.stringify({
    id: 'kbi',
    generator_config: { KnowledgeBase: { inlined: true } },
  }),
  'kb_inl/l.lesson/q.front.md': 'Q front',
  'kb_inl/l.lesson/q.back.md': 'Q back',
};

describe('пример spec D.5 (golden)', () => {
  it('каталог превращается в манифесты Trane', async () => {
    const files = { ...D5_FILES };
    // файл с суффиксом `.lesson` не урок
    files['kb_course/stray.lesson'] = 'file, not a directory';
    const { model, diagnostics } = await scan(memoryFiles(files));

    expect(model.courses.map((c) => c.manifest.id)).toEqual(['kb', 'kbi']);
    expect(model.courses[0]?.manifest).toMatchObject({
      id: 'kb',
      name: 'KB Course',
      course_instructions: {
        MarkdownAsset: { path: 'kb_course/course.instructions.md' },
      },
      generator_config: { KnowledgeBase: { inlined: false } },
    });

    expect(model.lessons.map((l) => l.manifest)).toEqual([
      {
        id: 'kb::advanced',
        dependencies: ['kb::intro', 'other::x'],
        encompassed: [['kb::intro', 0.5]],
        superseded: ['kb::intro'],
        course_id: 'kb',
        name: 'Lesson advanced',
        description: null,
        metadata: { topic: ['adv'] },
        lesson_material: null,
        lesson_instructions: null,
      },
      {
        id: 'kb::intro',
        dependencies: [],
        encompassed: [],
        superseded: [],
        course_id: 'kb',
        name: 'Introduction',
        description: null,
        metadata: null,
        lesson_material: null,
        lesson_instructions: {
          MarkdownAsset: {
            path: 'kb_course/intro.lesson/lesson.instructions.md',
          },
        },
      },
      {
        id: 'kbi::l',
        dependencies: [],
        encompassed: [],
        superseded: [],
        course_id: 'kbi',
        name: 'Lesson l',
        description: null,
        metadata: null,
        lesson_material: null,
        lesson_instructions: null,
      },
    ]);

    const flash = (dir: string, id: string, back: boolean) => ({
      FlashcardAsset: {
        front_path: `${dir}/${id}.front.md`,
        back_path: back ? `${dir}/${id}.back.md` : null,
      },
    });
    expect(model.exercises.map((e) => e.manifest)).toEqual([
      {
        id: 'kb::advanced::e1',
        lesson_id: 'kb::advanced',
        course_id: 'kb',
        name: 'Exercise e1',
        description: null,
        exercise_type: 'Procedural',
        exercise_asset: flash('kb_course/advanced.lesson', 'e1', true),
      },
      {
        id: 'kb::intro::a',
        lesson_id: 'kb::intro',
        course_id: 'kb',
        name: 'First card',
        description: 'About A',
        exercise_type: 'Declarative',
        exercise_asset: flash('kb_course/intro.lesson', 'a', true),
      },
      {
        id: 'kb::intro::b',
        lesson_id: 'kb::intro',
        course_id: 'kb',
        name: 'Exercise b',
        description: null,
        exercise_type: 'Declarative',
        exercise_asset: flash('kb_course/intro.lesson', 'b', false),
      },
      {
        id: 'kb::intro::d',
        lesson_id: 'kb::intro',
        course_id: 'kb',
        name: 'Exercise d',
        description: null,
        exercise_type: 'Procedural',
        exercise_asset: flash('kb_course/intro.lesson', 'd', false),
      },
      {
        id: 'kbi::l::q',
        lesson_id: 'kbi::l',
        course_id: 'kbi',
        name: 'Exercise q',
        description: null,
        exercise_type: 'Procedural',
        exercise_asset: {
          InlineFlashcardAsset: {
            front_content: 'Q front',
            back_content: 'Q back',
          },
        },
      },
    ]);

    // `.front.md` (пустой id), c.back.md (без front) и notes.txt; порядок — по пути
    expect(onlyCode(diagnostics, 'W_KB_STRAY_FILE').map((d) => d.path)).toEqual(
      [
        'kb_course/intro.lesson/.front.md',
        'kb_course/intro.lesson/c.back.md',
        'kb_course/intro.lesson/notes.txt',
      ],
    );
    expect(diagnostics).toHaveLength(3);
  });
});

describe('граничные случаи генератора', () => {
  const generate = async (files: Record<string, string>, inlined = false) => {
    const { reader, diagnostics } = readerFor(files);
    const entries = (await reader.list('c')) ?? [];
    const generated = await generateKnowledgeBaseCourse(
      reader,
      { id: 'c', dir: 'c' },
      entries,
      inlined,
    );
    return { ...generated, diagnostics };
  };

  it('уроки и упражнения идут по коду символов короткого id', async () => {
    const { lessons, exercises } = await generate({
      'c/b.lesson/z.front.md': 'x',
      'c/b.lesson/a.front.md': 'x',
      'c/a-b.lesson/x.front.md': 'x',
      'c/a.lesson/x.front.md': 'x',
      'c/B.lesson/x.front.md': 'x',
    });
    expect(lessons.map((l) => l.manifest.id)).toEqual([
      'c::B',
      'c::a',
      'c::a-b',
      'c::b',
    ]);
    expect(exercises.map((e) => e.manifest.id)).toEqual([
      'c::B::x',
      'c::a::x',
      'c::a-b::x',
      'c::b::a',
      'c::b::z',
    ]);
  });

  it('каталог `.lesson` без имени: E_ID_EMPTY, урок и упражнение остаются', async () => {
    const { lessons, exercises, diagnostics } = await generate({
      'c/.lesson/e.front.md': 'x',
    });
    expect(lessons.map((l) => l.manifest.id)).toEqual(['c::']);
    expect(exercises.map((e) => e.manifest.id)).toEqual(['c::::e']);
    expect(
      diagnostics.map(({ code, path, unitId }) => [code, path, unitId]),
    ).toEqual([['E_ID_EMPTY', 'c/.lesson', 'c::']]);
  });

  it('файл `*.lesson` и каталог без суффикса не уроки', async () => {
    const { lessons, diagnostics } = await generate({
      'c/stray.lesson': 'file',
      'c/plain/x.front.md': 'x',
    });
    expect(lessons).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('`x.y.front.md` — упражнение `x.y`', async () => {
    const { exercises } = await generate({ 'c/l.lesson/x.y.front.md': 'x' });
    expect(exercises.map((e) => e.manifest.id)).toEqual(['c::l::x.y']);
  });

  it('веса encompassed вне диапазона генератор не проверяет', async () => {
    const { lessons, diagnostics } = await generate({
      'c/l.lesson/lesson.encompassed.json': '[["l", 2.5], ["other::z", -1]]',
    });
    expect(lessons[0]?.manifest.encompassed).toEqual([
      ['c::l', 2.5],
      ['other::z', -1],
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('frontmatter front-файла даёт engine упражнения, битый — engineBroken', async () => {
    const { exercises, diagnostics } = await generate({
      'c/l.lesson/ok.front.md':
        '---\nengine:\n  tags: [a]\n  dok: 3\n---\nQuestion',
      'c/l.lesson/bad.front.md': '---\nengine:\n  dok: 9\n---\nQuestion',
    });
    const [bad, ok] = exercises;
    expect(ok?.engine).toEqual({ tags: ['a'], dok: 3 });
    expect(ok?.engineSrc).toEqual({ path: 'c/l.lesson/ok.front.md', line: 2 });
    expect(ok?.engineBroken).toBeUndefined();
    expect(bad?.engine).toBeUndefined();
    expect(bad?.engineBroken).toBe(true);
    expect(
      diagnostics.map(({ code, path, line }) => [code, path, line]),
    ).toEqual([['E_ENGINE_SCHEMA', 'c/l.lesson/bad.front.md', 3]]);
  });

  it('inlined: содержимое front включает frontmatter дословно', async () => {
    const text = '---\nengine:\n  tags: [a]\n---\nQuestion';
    const { exercises } = await generate(
      { 'c/l.lesson/e.front.md': text },
      true,
    );
    expect(exercises[0]?.manifest.exercise_asset).toEqual({
      InlineFlashcardAsset: { front_content: text, back_content: null },
    });
  });

  it('дубликат id с lesson_manifest.json сканер не ловит (граф — уровень компилятора)', async () => {
    const { model, diagnostics } = await scan(
      memoryFiles({
        'c/course_manifest.json': asJson({
          id: 'c',
          generator_config: { KnowledgeBase: {} },
        }),
        'c/l.lesson/e.front.md': 'x',
        'c/l/lesson_manifest.json': asJson({
          id: 'c::l',
          course_id: 'c',
          name: 'Dup',
        }),
      }),
    );
    expect(model.lessons.map((l) => l.manifest.id)).toEqual(['c::l', 'c::l']);
    expect(diagnostics).toEqual([]);
  });
});
