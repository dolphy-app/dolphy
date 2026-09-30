/**
 * Внесение известных дефектов в свежесгенерированную синтетическую
 * библиотеку (порт `spike/compiler/src/defects.ts`) и сверка диагностик:
 * каждый дефект должен быть найден с ожидаемым кодом и файлом, любая иная
 * warning/error — явный `collateral`. Дефекты с chmod 000 и симлинками на
 * `/etc/hosts` — на реальной ФС.
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import type { Diagnostic, DiagnosticCode } from '@lms/engine-contract';
import { plan } from './gen.ts';

/**
 * `chmod 000` не закрывает файл для root (контейнеры, CI): такой дефект
 * вносится в ожидания, только если файл действительно нечитаем (проба
 * возможности, а не проверка uid).
 */
const isUnreadable = (absolutePath: string): boolean => {
  try {
    readFileSync(absolutePath);
    return false;
  } catch {
    return true;
  }
};

export interface Expect {
  /** Короткое имя дефекта. */
  name: string;
  code: DiagnosticCode;
  /** Файл (от корня библиотеки), на который должна указывать диагностика. */
  path: string;
  line?: number;
  unitId?: string;
  /** Каждый id обязан присутствовать в `related` (или в тексте). */
  related?: string[];
}

export interface Negative {
  name: string;
  /** Без `code` запрещена любая warning/error на этом файле. */
  code?: DiagnosticCode;
  path: string;
}

export interface Injected {
  expect: Expect[];
  mustNot: Negative[];
  /** Законные следствия дефектов: код + файл. */
  collateral: Array<{ code: DiagnosticCode; path: string }>;
}

export type Layout = 'kb' | 'json';

export const MATRIX_PLAN = { lessons: 3000, courses: 30, seed: 88172645 };
export const MATRIX_EXERCISES = 4;

const P = plan(MATRIX_PLAN);
const pad = (n: number, width: number) => String(n).padStart(width, '0');
const lessonDir = (i: number, kb: boolean) =>
  `c${pad(Math.floor(i / P.perCourse), 2)}/${P.short(i)}${kb ? '.lesson' : ''}`;
const lid = (i: number) => P.lid(i);
const VER = ['  exercise:', '    type: lms.sql', '    timeoutMs: 2000'];
const front = (engine: string[], top: string[] = []) =>
  ['---', 'engine:', ...engine, ...top, '---', 'Body text.', ''].join('\n');

const lineOf = (text: string, needle: string) =>
  text.split('\n').findIndex((line) => line.includes(needle)) + 1;

type Json = Record<string, unknown>;

const createFiles = (root: string) => {
  const at = (rel: string) => `${root}/${rel}`;
  const write = (rel: string, text: string) => writeFileSync(at(rel), text);
  const read = (rel: string) => readFileSync(at(rel), 'utf8');
  const readJson = (rel: string) => JSON.parse(read(rel)) as Json;
  /** Записывает JSON с отступами; возвращает текст (для номеров строк). */
  const writePretty = (rel: string, value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    write(rel, text);
    return text;
  };
  return { at, write, read, readJson, writePretty };
};

/**
 * Урок ровно с `count` упражнениями (в синтетике их 4): лишние удаляются,
 * недостающие дописываются простыми front-файлами без `engine`.
 */
const resizeLesson = (root: string, kb: boolean, i: number, count: number) => {
  const { at, write, writePretty } = createFiles(root);
  const dir = lessonDir(i, kb);
  for (let e = count; e < MATRIX_EXERCISES; e++) {
    if (kb) {
      rmSync(at(`${dir}/e${e}.front.md`));
      rmSync(at(`${dir}/e${e}.back.md`));
    } else rmSync(at(`${dir}/e${e}`), { recursive: true });
  }
  for (let e = MATRIX_EXERCISES; e < count; e++) {
    if (kb) {
      write(`${dir}/e${e}.front.md`, `Question ${e}.\n`);
      write(`${dir}/e${e}.back.md`, `Answer ${e}.\n`);
      continue;
    }
    mkdirSync(at(`${dir}/e${e}`));
    writePretty(`${dir}/e${e}/exercise_manifest.json`, {
      id: `${lid(i)}::e${e}`,
      lesson_id: lid(i),
      course_id: P.cid(Math.floor(i / P.perCourse)),
      name: `Exercise ${e}`,
      exercise_type: 'Procedural',
      exercise_asset: {
        FlashcardAsset: { front_path: 'front.md', back_path: 'back.md' },
      },
    });
    write(`${dir}/e${e}/front.md`, `Question ${e}.\n`);
    write(`${dir}/e${e}/back.md`, `Answer ${e}.\n`);
  }
};

/** Курсы 10+ живут без `requiresChecks`: добавленным упражнениям проверка не нужна. */
const injectGranularity = (root: string, kb: boolean, out: Injected) => {
  const { readJson, writePretty } = createFiles(root);
  const lessonSrc = (i: number) =>
    kb ? lessonDir(i, true) : `${lessonDir(i, false)}/lesson_manifest.json`;
  const courseManifest = (c: number) => `c${pad(c, 2)}/course_manifest.json`;
  const setEngine = (c: number, patch: (engine: Json) => Json | undefined) => {
    const manifest = readJson(courseManifest(c));
    const engine = patch({ ...(manifest.engine as Json) });
    if (engine === undefined) delete manifest.engine;
    else manifest.engine = engine;
    writePretty(courseManifest(c), manifest);
  };
  const warn = (name: string, i: number) =>
    out.expect.push({
      name,
      code: 'W_GRANULARITY',
      path: lessonSrc(i),
      unitId: lid(i),
    });
  const silent = (name: string, i: number) =>
    out.mustNot.push({ name, code: 'W_GRANULARITY', path: lessonSrc(i) });

  // порог по умолчанию — 3..12 упражнений
  resizeLesson(root, kb, 1050, 2);
  warn('granularity_2_exercises', 1050);
  resizeLesson(root, kb, 1060, 13);
  warn('granularity_13_exercises', 1060);
  resizeLesson(root, kb, 1070, 3);
  silent('granularity_3_exercises_ok', 1070);
  resizeLesson(root, kb, 1080, 12);
  silent('granularity_12_exercises_ok', 1080);
  // порог курса переопределяет умолчание: 13 при max 14 — в норме
  setEngine(12, (engine) => ({ ...engine, granularity: { min: 2, max: 14 } }));
  resizeLesson(root, kb, 1210, 13);
  silent('granularity_course_override_widens', 1210);
  // 6 при max 5 — предупреждение, хотя по умолчанию 6 в норме
  setEngine(13, (engine) => ({ ...engine, granularity: { min: 1, max: 5 } }));
  resizeLesson(root, kb, 1310, 6);
  warn('granularity_course_override_narrows', 1310);
  // курс без блока `engine` проверке не подлежит
  setEngine(14, () => undefined);
  resizeLesson(root, kb, 1410, 2);
  silent('granularity_course_without_engine', 1410);
};

export const injectKb = (root: string): Injected => {
  const { at, write, readJson } = createFiles(root);
  const json = (rel: string, value: unknown) =>
    write(rel, JSON.stringify(value));
  const lf = (i: number, name: string) => `${lessonDir(i, true)}/${name}`;
  const ex = (i: number, e: number) => `${lessonDir(i, true)}/e${e}.front.md`;
  const eid = (i: number, e: number) => `${lid(i)}::e${e}`;
  const neutralize = (i: number) => {
    for (let e = 0; e < MATRIX_EXERCISES; e++) write(ex(i, e), front(VER));
    rmSync(at(lf(i, 'lesson.encompassed.json')), { force: true });
  };
  const deps = (i: number, d: number[]) =>
    json(
      lf(i, 'lesson.dependencies.json'),
      d.map((x) => P.short(x)),
    );
  const out: Injected = { expect: [], mustNot: [], collateral: [] };
  const ok = (e: Expect) => out.expect.push(e);

  // -- разбор и схема
  write(lf(61, 'lesson.name.json'), '{oops');
  ok({
    name: 'json_parse',
    code: 'E_JSON_PARSE',
    path: lf(61, 'lesson.name.json'),
    unitId: lid(61),
  });
  json(lf(62, 'lesson.name.json'), 42);
  ok({
    name: 'schema',
    code: 'E_SCHEMA',
    path: lf(62, 'lesson.name.json'),
    unitId: lid(62),
  });
  {
    const rel = 'c00/course_manifest.json';
    const text = JSON.stringify({ ...readJson(rel), weird: 1 }, null, 2);
    write(rel, text);
    ok({
      name: 'unknown_key_manifest',
      code: 'W_UNKNOWN_KEY',
      path: rel,
      line: lineOf(text, '"weird"'),
    });
  }
  write(ex(63, 0), front([...VER], ['foo: 1']));
  ok({
    name: 'unknown_key_frontmatter',
    code: 'W_UNKNOWN_KEY',
    path: ex(63, 0),
    line: 6,
    unitId: eid(63, 0),
  });
  write(
    ex(64, 0),
    '---\nengine:\n  tags: [a]\nbody text without closing fence\n',
  );
  ok({
    name: 'frontmatter_unterminated',
    code: 'E_FRONTMATTER_UNTERMINATED',
    path: ex(64, 0),
    line: 1,
    unitId: eid(64, 0),
  });
  write(ex(65, 0), '---\nengine:\n  tags: [a, b\n---\nbody\n');
  ok({
    name: 'frontmatter_parse_flow_sequence',
    code: 'E_FRONTMATTER_PARSE',
    path: ex(65, 0),
    unitId: eid(65, 0),
  });
  write(ex(66, 0), '---\nengine:\n  tags: a: b\n---\nbody\n');
  ok({
    name: 'frontmatter_parse_nested_mapping',
    code: 'E_FRONTMATTER_PARSE',
    path: ex(66, 0),
    line: 3,
    unitId: eid(66, 0),
  });
  write(ex(67, 0), front(['  bloom: nonsense', ...VER]));
  ok({
    name: 'engine_schema',
    code: 'E_ENGINE_SCHEMA',
    path: ex(67, 0),
    line: 3,
    unitId: eid(67, 0),
  });
  write(ex(68, 0), front(['  frobnicate: 1', ...VER]));
  ok({
    name: 'engine_unknown_key',
    code: 'W_ENGINE_UNKNOWN_KEY',
    path: ex(68, 0),
    line: 3,
    unitId: eid(68, 0),
  });

  // -- id и ссылки
  neutralize(71);
  json(lf(71, 'lesson.dependencies.json'), ['l00070', 'ghost']);
  ok({
    name: 'dep_missing',
    code: 'E_DEP_MISSING',
    path: lf(71, 'lesson.dependencies.json'),
    unitId: lid(71),
    related: ['ghost'],
  });
  neutralize(72);
  json(lf(72, 'lesson.dependencies.json'), ['l00071', 'l00072']);
  ok({
    name: 'dep_self',
    code: 'E_DEP_SELF',
    path: lf(72, 'lesson.dependencies.json'),
    unitId: lid(72),
  });
  neutralize(74);
  json(lf(74, 'lesson.dependencies.json'), ['l00072', `${lid(75)}::e0`]);
  ok({
    name: 'dep_on_exercise',
    code: 'E_DEP_KIND',
    path: lf(74, 'lesson.dependencies.json'),
    unitId: lid(74),
    related: [`${lid(75)}::e0`],
  });

  // -- циклы
  for (const i of [120, 121, 122]) neutralize(i);
  deps(120, [122]);
  deps(121, [120]);
  deps(122, [121]);
  ok({
    name: 'cycle_dependency',
    code: 'E_CYCLE_DEPENDENCY',
    path: lf(120, 'lesson.dependencies.json'),
    related: [lid(120), lid(121), lid(122)],
  });
  neutralize(191);
  neutralize(192);
  json(lf(191, 'lesson.superseded.json'), ['l00192']);
  json(lf(192, 'lesson.superseded.json'), ['l00191']);
  ok({
    name: 'cycle_superseded',
    code: 'E_CYCLE_SUPERSEDED',
    path: lf(191, 'lesson.superseded.json'),
    related: [lid(191), lid(192)],
  });
  neutralize(180);
  neutralize(181);
  deps(180, [179]);
  deps(181, [180]);
  json(lf(180, 'lesson.encompassed.json'), [['l00181', 0.5]]);
  json(lf(181, 'lesson.encompassed.json'), [['l00180', 0.5]]);
  json(lf(180, 'lesson.engine.json'), { nonAncestor: true });
  ok({
    name: 'cycle_encompassed',
    code: 'E_CYCLE_ENCOMPASSED',
    path: lf(180, 'lesson.encompassed.json'),
    related: [lid(180), lid(181)],
  });
  out.mustNot.push({
    name: 'nonAncestor_exempts_target',
    code: 'E_ENC_NOT_ANCESTOR',
    path: lf(180, 'lesson.encompassed.json'),
  });

  // -- encompassed
  neutralize(134);
  deps(134, [133]);
  json(lf(134, 'lesson.encompassed.json'), [['l00133', 1.5]]);
  ok({
    name: 'enc_weight',
    code: 'E_ENC_WEIGHT',
    path: lf(134, 'lesson.encompassed.json'),
    unitId: lid(134),
  });
  neutralize(136);
  deps(136, [135]);
  json(lf(136, 'lesson.encompassed.json'), [['l99999', 0.5]]);
  ok({
    name: 'enc_missing',
    code: 'E_ENC_MISSING',
    path: lf(136, 'lesson.encompassed.json'),
    unitId: lid(136),
  });
  neutralize(153);
  deps(153, [152]);
  json(lf(153, 'lesson.encompassed.json'), [[lid(10), 0.5]]);
  ok({
    name: 'enc_not_ancestor',
    code: 'E_ENC_NOT_ANCESTOR',
    path: lf(153, 'lesson.encompassed.json'),
    unitId: lid(153),
    related: [lid(10)],
  });
  neutralize(190);
  json(lf(190, 'lesson.superseded.json'), ['ghost']);
  ok({
    name: 'sup_missing',
    code: 'E_SUP_MISSING',
    path: lf(190, 'lesson.superseded.json'),
    unitId: lid(190),
  });

  // -- форма графа
  neutralize(202);
  deps(202, [201, 200]);
  ok({
    name: 'redundant_edge',
    code: 'W_REDUNDANT_EDGE',
    path: lf(202, 'lesson.dependencies.json'),
    unitId: lid(202),
    related: [lid(200)],
  });
  mkdirSync(at('c01/l09999.lesson'), { recursive: true });
  json('c01/l09999.lesson/lesson.name.json', 'Orphan');
  ok({
    name: 'orphan_lesson',
    code: 'W_ORPHAN_LESSON',
    path: 'c01/l09999.lesson',
    unitId: 'syn::c01::l09999',
  });
  neutralize(420);
  json(
    lf(420, 'lesson.dependencies.json'),
    [0, 50, 100, 150, 200, 250, 300, 350].map(lid),
  );
  ok({
    name: 'fan_in_8',
    code: 'W_FAN_IN',
    path: lf(420, 'lesson.dependencies.json'),
    unitId: lid(420),
  });

  // -- семантика расширения `engine`
  write(ex(450, 0), front([...VER, '  keyPrerequisites: [ghost]']));
  ok({
    name: 'keyprereq_missing',
    code: 'E_KEYPREREQ_MISSING',
    path: ex(450, 0),
    unitId: eid(450, 0),
    related: ['ghost'],
  });
  write(ex(460, 0), front([...VER, `  keyPrerequisites: ["${lid(0)}"]`]));
  ok({
    name: 'keyprereq_not_ancestor',
    code: 'E_KEYPREREQ_NOT_ANCESTOR',
    path: ex(460, 0),
    unitId: eid(460, 0),
    related: [lid(0)],
  });
  write(ex(300, 1), front(['  tags: [x]']));
  ok({
    name: 'no_verification_required',
    code: 'E_NO_VERIFICATION',
    path: ex(300, 1),
    unitId: eid(300, 1),
  });

  // -- генераторы, лишние файлы, ассеты, ввод-вывод
  for (const [dir, kind] of [
    ['x_lit', 'Literacy'],
    ['y_trans', 'Transcription'],
  ] as const) {
    mkdirSync(at(dir), { recursive: true });
    const text = JSON.stringify(
      { id: `gen::${dir}`, name: dir, generator_config: { [kind]: {} } },
      null,
      2,
    );
    write(`${dir}/course_manifest.json`, text);
    ok({
      name: `unsupported_generator_${kind}`,
      code: 'W_UNSUPPORTED_GENERATOR',
      path: `${dir}/course_manifest.json`,
      line: lineOf(text, 'generator_config'),
      unitId: `gen::${dir}`,
    });
  }
  write(lf(470, 'notes.txt'), 'stray');
  ok({
    name: 'kb_stray_file',
    code: 'W_KB_STRAY_FILE',
    path: lf(470, 'notes.txt'),
    unitId: lid(470),
  });
  write(lf(471, 'x.back.md'), 'back without front');
  ok({
    name: 'kb_back_without_front',
    code: 'W_KB_STRAY_FILE',
    path: lf(471, 'x.back.md'),
    unitId: lid(471),
  });
  rmSync(at(ex(480, 2)));
  symlinkSync('/etc/hosts', at(ex(480, 2)));
  ok({
    name: 'symlink_asset_escapes_root',
    code: 'E_ASSET_ESCAPES_ROOT',
    path: ex(480, 2),
    unitId: eid(480, 2),
  });
  json(lf(490, 'lesson.description.json'), 'd');
  chmodSync(at(lf(490, 'lesson.description.json')), 0o000);
  if (isUnreadable(at(lf(490, 'lesson.description.json')))) {
    ok({
      name: 'unreadable_file',
      code: 'E_IO',
      path: lf(490, 'lesson.description.json'),
    });
  }

  // урок-сирота без упражнений законно выходит за порог гранулярности
  out.collateral.push({ code: 'W_GRANULARITY', path: 'c01/l09999.lesson' });

  // переподключённые уроки меняют замыкание своих зависимых: их рёбра стали избыточными
  for (const i of [73, 75, 129, 141, 161, 186, 189]) {
    out.collateral.push({
      code: 'W_REDUNDANT_EDGE',
      path: lf(i, 'lesson.dependencies.json'),
    });
  }

  // -- негативы: должны молчать (уроки с номером 1000+ — в курсах без requiresChecks)
  write(
    ex(1000, 0),
    '---\nJust a horizontal rule\n---\nLooks like frontmatter but is prose.\n',
  );
  write(
    ex(1000, 1),
    'Intro paragraph.\n\n---\nengine:\n  exercise:\n    type: nonsense\n---\nSecond half.\n',
  );
  write(
    ex(1000, 2),
    "---\r\nengine:\r\n  tags: [crlf, \"a: b\", 'it''s']\r\n---\r\nТело ✓\r\n",
  );
  write(ex(1000, 3), '\ufeff---\nengine:\n  tags: [bom]\n...\nbody\n');
  for (let e = 0; e < 4; e++) {
    out.mustNot.push({
      name: 'benign_frontmatter_lookalike',
      path: ex(1000, e),
    });
  }

  injectGranularity(root, true, out);
  return out;
};

export const injectJson = (root: string): Injected => {
  const { at, write, read, readJson, writePretty } = createFiles(root);
  const em = (i: number, e: number) =>
    `${lessonDir(i, false)}/e${e}/exercise_manifest.json`;
  const fr = (i: number, e: number) => `${lessonDir(i, false)}/e${e}/front.md`;
  const eid = (i: number, e: number) => `${lid(i)}::e${e}`;
  const out: Injected = { expect: [], mustNot: [], collateral: [] };
  const ok = (e: Expect) => out.expect.push(e);
  const mutate = (i: number, e: number, change: (m: Json) => void) => {
    const manifest = readJson(em(i, e));
    change(manifest);
    return writePretty(em(i, e), manifest);
  };

  let text = mutate(20, 0, (m) => {
    m.id = '';
  });
  ok({
    name: 'id_empty',
    code: 'E_ID_EMPTY',
    path: em(20, 0),
    line: lineOf(text, '"id"'),
  });
  text = mutate(21, 1, (m) => {
    m.id = eid(21, 0);
  });
  ok({
    name: 'id_duplicate',
    code: 'E_ID_DUPLICATE',
    path: em(21, 1),
    line: lineOf(text, '"id"'),
    unitId: eid(21, 0),
  });
  text = mutate(22, 0, (m) => {
    m.lesson_id = lid(99);
  });
  ok({
    name: 'id_mismatch_lesson_id',
    code: 'E_ID_MISMATCH',
    path: em(22, 0),
    line: lineOf(text, '"lesson_id"'),
    unitId: eid(22, 0),
  });
  text = mutate(23, 0, (m) => {
    m.exercise_asset = {
      FlashcardAsset: { front_path: 'nofile.md', back_path: null },
    };
  });
  ok({
    name: 'asset_missing',
    code: 'E_ASSET_MISSING',
    path: em(23, 0),
    line: lineOf(text, '"exercise_asset"'),
    unitId: eid(23, 0),
  });
  text = mutate(24, 0, (m) => {
    m.exercise_asset = {
      FlashcardAsset: {
        front_path: '../../../../../etc/hosts',
        back_path: null,
      },
    };
  });
  ok({
    name: 'asset_escapes_root_dotdot',
    code: 'E_ASSET_ESCAPES_ROOT',
    path: em(24, 0),
    line: lineOf(text, '"exercise_asset"'),
    unitId: eid(24, 0),
  });
  out.collateral.push(
    { code: 'E_ASSET_MISSING', path: em(24, 0) },
    { code: 'E_ASSET_TYPE', path: em(24, 0) },
  );
  rmSync(at(fr(25, 0)));
  symlinkSync('/etc/hosts', at(fr(25, 0)));
  ok({
    name: 'asset_symlink_escapes_root',
    code: 'E_ASSET_ESCAPES_ROOT',
    path: em(25, 0),
    unitId: eid(25, 0),
  });
  write(fr(26, 0).replace('front.md', 'front.txt'), 'text');
  text = mutate(26, 0, (m) => {
    m.exercise_asset = {
      FlashcardAsset: { front_path: 'front.txt', back_path: null },
    };
  });
  ok({
    name: 'asset_type',
    code: 'E_ASSET_TYPE',
    path: em(26, 0),
    line: lineOf(text, '"exercise_asset"'),
    unitId: eid(26, 0),
  });
  text = mutate(27, 0, (m) => {
    m.exercise_asset = {
      SoundSliceAsset: { link: 'https://x', description: null, backup: null },
    };
  });
  ok({
    name: 'asset_kind_unsupported',
    code: 'W_ASSET_KIND_UNSUPPORTED',
    path: em(27, 0),
    line: lineOf(text, '"exercise_asset"'),
    unitId: eid(27, 0),
  });
  // у SoundSlice нет front-файла: проверка возможна только из ключа `engine` манифеста, ошибка законна
  out.collateral.push({ code: 'E_NO_VERIFICATION', path: em(27, 0) });
  mutate(28, 0, (m) => {
    m.engine = { tags: ['x'] };
  });
  ok({
    name: 'engine_in_manifest_and_frontmatter',
    code: 'E_ENGINE_DUPLICATE',
    path: fr(28, 0),
    line: 2,
    unitId: eid(28, 0),
  });
  text = mutate(29, 0, (m) => {
    m.foo = 1;
  });
  ok({
    name: 'unknown_key_exercise_manifest',
    code: 'W_UNKNOWN_KEY',
    path: em(29, 0),
    line: lineOf(text, '"foo"'),
    unitId: eid(29, 0),
  });
  {
    const rel = `${lessonDir(30, false)}/lesson_manifest.json`;
    const manifest = readJson(rel);
    manifest.course_id = 'syn::c09';
    const lessonText = writePretty(rel, manifest);
    ok({
      name: 'id_mismatch_course_id',
      code: 'E_ID_MISMATCH',
      path: rel,
      line: lineOf(lessonText, '"course_id"'),
      unitId: lid(30),
    });
  }
  mutate(33, 0, (m) => {
    m.exercise_type = 'Weird';
  });
  ok({ name: 'schema_enum', code: 'E_SCHEMA', path: em(33, 0) });
  write(em(34, 0), read(em(34, 0)).slice(0, 60));
  ok({ name: 'json_parse', code: 'E_JSON_PARSE', path: em(34, 0) });
  chmodSync(at(fr(35, 0)), 0o000);
  if (isUnreadable(at(fr(35, 0)))) {
    ok({ name: 'unreadable_front', code: 'E_IO', path: fr(35, 0) });
  }
  {
    const rel = `${lessonDir(36, false)}/lesson_manifest.json`;
    const manifest = readJson(rel);
    manifest.engine = { wat: 1 };
    const lessonText = writePretty(rel, manifest);
    ok({
      name: 'lesson_engine_unknown_key',
      code: 'W_ENGINE_UNKNOWN_KEY',
      path: rel,
      line: lineOf(lessonText, '"engine"'),
      unitId: lid(36),
    });
  }
  write(fr(37, 0), '---\nengine:\n  tags: [x]\n---\nNo check here.\n');
  ok({
    name: 'no_verification_required',
    code: 'E_NO_VERIFICATION',
    path: fr(37, 0),
    unitId: eid(37, 0),
  });

  injectGranularity(root, false, out);
  return out;
};

export interface MatrixRow {
  name: string;
  code: string;
  expectedPath: string;
  expectedLine: number | null;
  found: boolean;
  foundAt: string;
  lineOk: boolean;
}

export interface Evaluation {
  rows: MatrixRow[];
  /** Warning/error, которые не объяснены ни дефектом, ни `collateral`. */
  unexplained: Diagnostic[];
  /** Диагностики на файлах негативных случаев. */
  violated: Array<{ name: string; diagnostic: Diagnostic }>;
}

const isCollateral = (d: Diagnostic, inj: Injected) =>
  inj.collateral.some((c) => c.code === d.code && c.path === d.path);

/** Сверяет диагностики с внесёнными дефектами. */
export const evaluate = (
  diagnostics: readonly Diagnostic[],
  inj: Injected,
): Evaluation => {
  const used = new Set<Diagnostic>();
  const rows: MatrixRow[] = [];
  for (const expected of inj.expect) {
    const candidates = diagnostics.filter(
      (d) =>
        d.code === expected.code &&
        d.path === expected.path &&
        (expected.unitId === undefined ||
          d.unitId === expected.unitId ||
          (d.related ?? []).includes(expected.unitId)),
    );
    const related = expected.related ?? [];
    const withRelated = candidates.filter((d) =>
      related.every(
        (id) => (d.related ?? []).includes(id) || d.message.includes(id),
      ),
    );
    const hit =
      withRelated.find(
        (d) => expected.line === undefined || d.line === expected.line,
      ) ?? withRelated[0];
    if (hit) used.add(hit);
    rows.push({
      name: expected.name,
      code: expected.code,
      expectedPath: expected.path,
      expectedLine: expected.line ?? null,
      found: hit !== undefined,
      foundAt: hit
        ? `${hit.path}${hit.line !== undefined ? `:${hit.line}` : ''}`
        : '-',
      lineOk:
        hit !== undefined &&
        (expected.line === undefined || hit.line === expected.line),
    });
  }
  const unexplained = diagnostics.filter(
    (d) => d.severity !== 'info' && !used.has(d) && !isCollateral(d, inj),
  );
  const violated: Evaluation['violated'] = [];
  for (const negative of inj.mustNot) {
    for (const diagnostic of diagnostics) {
      if (diagnostic.path !== negative.path || diagnostic.severity === 'info') {
        continue;
      }
      if (negative.code !== undefined && diagnostic.code !== negative.code) {
        continue;
      }
      if (isCollateral(diagnostic, inj)) continue;
      violated.push({ name: negative.name, diagnostic });
    }
  }
  return { rows, unexplained, violated };
};
