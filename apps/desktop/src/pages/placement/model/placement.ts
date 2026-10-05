import { computed, ref, shallowRef, toRaw } from 'vue';
import type {
  ExerciseDto,
  ExerciseTaskDto,
  Grade,
  LearningEngine,
  PlacementProgressDto,
  PlacementProbeDto,
  PlacementResult,
  UnitId,
  VerdictDto,
} from '@dolphy-app/engine-contract';
import { readAllPages } from '@/shared/lib/read-all-pages.ts';
import {
  readExerciseContent,
  readOptionalText,
} from '@/shared/lib/read-exercise-content.ts';
import { defaultBudget, maxBudget, normalizeBudget } from '../lib/budget.ts';
import {
  SKIP_GRADE,
  activeSessionOf,
  describeSummary,
} from '../lib/progress.ts';
import type { PlacementResultView } from '../lib/progress.ts';

export type PlacementStage =
  'loading' | 'intro' | 'probing' | 'finished' | 'failed';

/** Шаг, который повторяет `retry` после сбоя (стадия `failed`). */
type Step = 'load' | 'begin' | 'advance' | 'finish';

export interface IntroInfo {
  /** Название курса; `null` — тест по всем курсам. */
  courseName: string | null;
  lessonCount: number;
  defaultBudget: number;
  maxBudget: number;
}

export interface CurrentProbe {
  probeId: string;
  exerciseId: UnitId;
  title: string;
  lessonName: string;
  courseName: string;
  /** Markdown условия. */
  prompt: string;
  answer: string | null;
  /** Ответ проверяет раннер; иначе ученик ставит себе оценку. */
  verifiable: boolean;
  /** Вид задания от расширения; `null` — задание без проверки. */
  task: ExerciseTaskDto | null;
  /** Публичный вид для элемента ответа (`project()` расширения). */
  view: unknown;
  /** Открытая попытка проверяемого упражнения. */
  attemptId: string | null;
  /** Markdown материала урока. */
  material: string | null;
}

export interface PlacementOptions {
  /** Курс, по которому идёт тест; без него — все курсы. */
  courseId?: UnitId;
  seed?: number;
  /** Источник `requestId` для `finish`; по умолчанию `crypto.randomUUID`. */
  newRequestId?: () => string;
}

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

export const createPlacement = (
  engine: LearningEngine,
  options: PlacementOptions = {},
) => {
  const newRequestId = options.newRequestId ?? (() => crypto.randomUUID());
  const courseIds = options.courseId === undefined ? [] : [options.courseId];

  const stage = ref<PlacementStage>('loading');
  const busy = ref(false);
  const error = ref<string | null>(null);
  const intro = shallowRef<IntroInfo | null>(null);
  const budget = ref(1);
  const progress = shallowRef<PlacementProgressDto | null>(null);
  const current = shallowRef<CurrentProbe | null>(null);
  const verdict = shallowRef<VerdictDto | null>(null);
  const revealed = ref(false);
  const result = shallowRef<PlacementResultView | null>(null);
  /** Результат отменён (`practice.undo`): записанные тестом попытки не действуют. */
  const undone = ref(false);

  let sessionId: string | null = null;
  let requestId: string | null = null;
  /** `requestId` завершённого теста: по нему `practice.undo` снимает всю пачку попыток. */
  let finishedId: string | null = null;
  let step: Step = 'load';
  let lessonNames = new Map<UnitId, string>();

  /** Ответ раннера, который можно засчитать: `passed` или `failed`. */
  const checked = computed(
    () => verdict.value !== null && verdict.value.outcome !== 'error',
  );
  const passed = computed(() => verdict.value?.outcome === 'passed');
  const asked = computed(() => progress.value?.asked ?? 0);
  /** Номер вопроса на экране, с единицы. */
  const position = computed(() => asked.value + 1);

  const load = async () => {
    const units = await Promise.all(
      courseIds.map((id) => engine.library.getUnit(id)),
    );
    const courses =
      courseIds.length > 0
        ? units.map((unit) => {
            if (unit.kind !== 'course')
              throw new Error(`${unit.id} is not a course`);
            return unit;
          })
        : await readAllPages((req) => engine.library.listCourses(req));
    const lessons = await Promise.all(
      courses.map(({ id }) =>
        readAllPages((req) => engine.library.listLessons(id, req)),
      ),
    );
    lessonNames = new Map(lessons.flat().map(({ id, name }) => [id, name]));
    const lessonCount = courses.reduce((sum, { lessonCount: n }) => sum + n, 0);
    intro.value = {
      courseName: options.courseId === undefined ? null : courses[0].name,
      lessonCount,
      defaultBudget: defaultBudget(lessonCount),
      maxBudget: maxBudget(lessonCount),
    };
    budget.value = defaultBudget(lessonCount);
  };

  /** Сбой шага `step`: экран `failed` с повтором через `retry`. */
  const fail = (caught: unknown) => {
    error.value = errorText(caught);
    stage.value = 'failed';
  };

  const openProbe = async (probe: PlacementProbeDto) => {
    const unit = await engine.library.getUnit(probe.exerciseId);
    if (unit.kind !== 'exercise')
      throw new Error(`${unit.id} is not an exercise`);
    const exercise: ExerciseDto = unit;
    const [text, lesson, course] = await Promise.all([
      readExerciseContent(engine, exercise.content),
      engine.library.getUnit(exercise.lessonId),
      engine.library.getUnit(exercise.courseId),
    ]);
    if (lesson.kind !== 'lesson')
      throw new Error(`${lesson.id} is not a lesson`);
    const material = await readOptionalText(engine, lesson.material);
    const attempt = exercise.task
      ? await engine.practice.beginAttempt({ exerciseId: exercise.id })
      : null;
    current.value = {
      probeId: probe.probeId,
      exerciseId: exercise.id,
      title: exercise.name,
      lessonName: lesson.name,
      courseName: course.name,
      prompt: text.prompt,
      answer: text.answer,
      verifiable: attempt?.verifiable ?? false,
      task: exercise.task ?? null,
      view: attempt?.view ?? null,
      attemptId: attempt?.attemptId ?? null,
      material,
    };
    verdict.value = null;
    revealed.value = false;
  };

  /** Завершение идемпотентно по `requestId`: повтор после сбоя безопасен. */
  const conclude = async () => {
    if (sessionId === null) return;
    requestId ??= newRequestId();
    const summary = await engine.placement.finish({ sessionId, requestId });
    result.value = describeSummary(summary, lessonNames);
    undone.value = false;
    finishedId = requestId;
    current.value = null;
    sessionId = null;
    requestId = null;
    stage.value = 'finished';
  };

  /** Следующая проба или, если проб больше нет, итог. */
  const advance = async () => {
    if (sessionId === null) return;
    const probe = await engine.placement.nextProbe(sessionId);
    if (probe === null) {
      step = 'finish';
      await conclude();
      return;
    }
    await openProbe(probe);
    stage.value = 'probing';
  };

  const guarded = async (action: () => Promise<void>) => {
    if (busy.value) return;
    busy.value = true;
    error.value = null;
    try {
      await action();
    } catch (caught) {
      error.value = errorText(caught);
    } finally {
      busy.value = false;
    }
  };

  /** Шаг, после сбоя которого экран уходит в `failed` (с повтором через `retry`). */
  const guardedStep = async (failedStep: Step, action: () => Promise<void>) => {
    if (busy.value) return;
    busy.value = true;
    error.value = null;
    step = failedStep;
    try {
      await action();
    } catch (caught) {
      fail(caught);
    } finally {
      busy.value = false;
    }
  };

  const start = async () => {
    const request = {
      budget: normalizeBudget(budget.value, intro.value?.lessonCount ?? 1),
      ...(courseIds.length > 0 && { courseIds }),
      ...(options.seed !== undefined && { seed: options.seed }),
    };
    let started;
    try {
      started = await engine.placement.start(request);
    } catch (caught) {
      // сессия осталась от ушедшей страницы: она одна на профиль, закрываем её
      const stale = activeSessionOf(caught);
      if (stale === null) throw caught;
      await engine.placement.abort({ sessionId: stale });
      started = await engine.placement.start(request);
    }
    sessionId = started.sessionId;
    requestId = null;
    step = 'advance';
    progress.value = { asked: 0, budget: started.budget, unresolved: 0 };
    await advance();
  };

  const init = async () => {
    stage.value = 'loading';
    error.value = null;
    step = 'load';
    try {
      await load();
      stage.value = 'intro';
    } catch (caught) {
      fail(caught);
    }
  };

  const begin = () => guardedStep('begin', start);

  /** Повтор шага, на котором случился сбой. */
  const retry = () => {
    if (step === 'load') return init();
    if (step === 'begin') return guardedStep('begin', start);
    return guardedStep(step, step === 'finish' ? conclude : advance);
  };

  const answerWith = async (answered: PlacementResult) => {
    const probe = current.value;
    if (!probe || sessionId === null) return;
    progress.value = await engine.placement.answer({
      probeId: probe.probeId,
      result: answered,
    });
    // ответ принят: дальнейший сбой повторяет переход, а не ответ
    step = 'advance';
    try {
      await advance();
    } catch (caught) {
      fail(caught);
    }
  };

  /** Проверка ответа расширением; засчитывается отдельным шагом `confirm`. */
  const submit = (answer: unknown) =>
    guarded(async () => {
      const probe = current.value;
      if (!probe?.verifiable || probe.attemptId === null) return;
      verdict.value = await engine.practice.submitAnswer({
        attemptId: probe.attemptId,
        // реактивный Proxy не клонируется при отправке по MessagePort
        answer: toRaw(answer),
      });
    });

  /** Засчитать итог проверки (последний `passed`/`failed`) и идти дальше. */
  const confirm = () =>
    guarded(async () => {
      const probe = current.value;
      if (!probe || probe.attemptId === null || !checked.value) return;
      await answerWith({ kind: 'attempt', attemptId: probe.attemptId });
    });

  const selfGrade = (grade: Grade) =>
    guarded(() => answerWith({ kind: 'grade', grade }));

  /** «Не знаю / пропустить» — самооценка 1. */
  const skip = () => selfGrade(SKIP_GRADE);

  const reveal = () => {
    revealed.value = true;
  };

  const finishEarly = () =>
    guardedStep('finish', async () => {
      if (sessionId !== null) await conclude();
    });

  /** Закрывает открытую сессию без записи в журнал; ошибки не важны. */
  const abort = async () => {
    const id = sessionId;
    sessionId = null;
    requestId = null;
    if (id === null) return;
    try {
      await engine.placement.abort({ sessionId: id });
    } catch {
      // abort неизвестной сессии — no-op; остальное сессия сама истечёт по TTL
    }
  };

  /** «Отменить результат»: попытки теста перестают влиять на траекторию, в журнале остаются. */
  const undoResult = () =>
    guarded(async () => {
      if (finishedId === null || undone.value) return;
      await engine.practice.undo({
        targetId: finishedId,
        requestId: newRequestId(),
      });
      undone.value = true;
    });

  /** «Вернуть результат» после отмены. */
  const redoResult = () =>
    guarded(async () => {
      if (finishedId === null || !undone.value) return;
      await engine.practice.redo({
        targetId: finishedId,
        requestId: newRequestId(),
      });
      undone.value = false;
    });

  return {
    stage,
    busy,
    error,
    intro,
    budget,
    progress,
    current,
    verdict,
    revealed,
    result,
    undone,
    checked,
    passed,
    position,
    init,
    begin,
    retry,
    submit,
    confirm,
    selfGrade,
    skip,
    reveal,
    finishEarly,
    abort,
    undoResult,
    redoResult,
  };
};
