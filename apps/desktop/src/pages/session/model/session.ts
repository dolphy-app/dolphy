import { computed, ref, shallowRef, toRaw } from 'vue';
import type {
  CompleteAttemptRequest,
  Grade,
  ExerciseTaskDto,
  ItemReason,
  LearningEngine,
  PlanItemDto,
  RecordResultDto,
  UnitId,
  VerdictDto,
} from '@dolphy-app/engine-contract';
import { PLAN_MAX_ITEMS } from '@/shared/config/plan.ts';
import {
  readExerciseContent,
  readOptionalText,
} from '@/shared/lib/read-exercise-content.ts';

export type SessionStage =
  'loading' | 'failed' | 'empty' | 'answering' | 'reviewed' | 'finished';

export interface CurrentExercise {
  attemptId: string;
  exerciseId: UnitId;
  title: string;
  reason: ItemReason;
  prompt: string;
  answer: string | null;
  /** Ответ проверяет раннер; иначе ученик ставит себе оценку. */
  verifiable: boolean;
  /** Вид проверяемого задания (элемент ввода ответа); `null` — самопроверка. */
  task: ExerciseTaskDto | null;
  /** Публичный вид от расширения (`project`), передаётся элементу ввода. */
  view: unknown;
  lessonName: string;
  courseName: string;
  /** Markdown материала урока (панель справа). */
  material: string | null;
}

export interface SessionSummary {
  count: number;
  averageGrade: number;
  /** Оценка ≥ 3: упражнение пройдено. */
  passed: number;
}

export interface SessionOptions {
  seed?: number;
  /** Курс, по которому строится сессия; без него — все курсы. */
  courseId?: UnitId;
  /** Идентификатор запроса отмены и возврата; по умолчанию `crypto.randomUUID`. */
  newRequestId?: () => string;
}

interface AnsweredItem {
  index: number;
  result: RecordResultDto;
}

const PASSING_GRADE = 3;

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

export const createSession = (
  engine: LearningEngine,
  options: SessionOptions = {},
) => {
  const stage = ref<SessionStage>('loading');
  const busy = ref(false);
  const error = ref<string | null>(null);
  const current = shallowRef<CurrentExercise | null>(null);
  const verdict = shallowRef<VerdictDto | null>(null);
  const result = shallowRef<RecordResultDto | null>(null);
  const remediation = ref<string[]>([]);
  const revealed = ref(false);
  const position = ref(0);
  const total = ref(0);
  const results = shallowRef<RecordResultDto[]>([]);
  /** Записанные ответы по порядку: что снимает «Отменить». `index` — упражнение плана. */
  const answered = shallowRef<AnsweredItem[]>([]);
  /** Отменённые ответы: что возвращает «Вернуть»; новый ответ их сбрасывает. */
  const undone = shallowRef<AnsweredItem[]>([]);
  const newRequestId = options.newRequestId ?? (() => crypto.randomUUID());
  let items: PlanItemDto[] = [];
  /** Сессия движка (`startSession`): id нужен, чтобы сообщить о конце обучения. */
  let engineSession: Promise<string | null> | null = null;

  /**
   * Сессия обучения в движке начинается вместе с первым упражнением плана.
   * Сбой не мешает занятию: расширения просто не получат события сессии.
   */
  const openEngineSession = (): Promise<string | null> =>
    Promise.resolve()
      .then(() => engine.practice.startSession())
      .then(({ sessionId }) => sessionId)
      .catch(() => null);

  /** Один раз на сессию, когда экран дошёл до итога; выход посреди занятия не вызывает. */
  const finishEngineSession = () => {
    const opened = engineSession;
    engineSession = null;
    if (opened === null) return;
    void opened
      .then((sessionId) =>
        sessionId === null
          ? undefined
          : engine.practice.finishSession({ sessionId }),
      )
      .catch(() => undefined);
  };

  const summary = computed<SessionSummary>(() => {
    const count = results.value.length;
    const sum = results.value.reduce((acc, { grade }) => acc + grade, 0);
    return {
      count,
      averageGrade: count ? sum / count : 0,
      passed: results.value.filter(({ grade }) => grade >= PASSING_GRADE)
        .length,
    };
  });

  const openExercise = async (index: number) => {
    const { exerciseId, reason } = items[index];
    const attempt = await engine.practice.beginAttempt({ exerciseId });
    const { exercise } = attempt;
    const [text, lesson, course] = await Promise.all([
      readExerciseContent(engine, exercise.content),
      engine.library.getUnit(exercise.lessonId),
      engine.library.getUnit(exercise.courseId),
    ]);
    if (lesson.kind !== 'lesson')
      throw new Error(`${lesson.id} is not a lesson`);
    const material = await readOptionalText(engine, lesson.material);
    current.value = {
      attemptId: attempt.attemptId,
      exerciseId,
      title: exercise.name,
      reason,
      prompt: text.prompt,
      answer: text.answer,
      verifiable: attempt.verifiable,
      task: exercise.task ?? null,
      view: attempt.view,
      lessonName: lesson.name,
      courseName: course.name,
      material,
    };
    verdict.value = null;
    result.value = null;
    remediation.value = [];
    revealed.value = false;
    position.value = index + 1;
    stage.value = 'answering';
  };

  const advance = async () => {
    if (position.value >= total.value) {
      stage.value = 'finished';
      finishEngineSession();
      return;
    }
    await openExercise(position.value);
  };

  const complete = async (
    grading: Omit<CompleteAttemptRequest, 'attemptId'>,
  ) => {
    if (!current.value) return;
    const recorded = await engine.practice.completeAttempt({
      attemptId: current.value.attemptId,
      ...grading,
    });
    results.value = [...results.value, recorded];
    answered.value = [
      ...answered.value,
      { index: position.value - 1, result: recorded },
    ];
    undone.value = [];
    result.value = recorded;
    if (recorded.remediation?.active) {
      const steps = recorded.remediation.steps;
      const units = await Promise.all(
        steps.map(({ unitId }) => engine.library.getUnit(unitId)),
      );
      remediation.value = units.map(({ name }) => name);
    }
    stage.value = 'reviewed';
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

  const start = async () => {
    stage.value = 'loading';
    error.value = null;
    try {
      const plan = await engine.plan.getDay({
        maxItems: PLAN_MAX_ITEMS,
        seed: options.seed,
        ...(options.courseId !== undefined && {
          courseIds: [options.courseId],
        }),
      });
      items = plan.items;
      total.value = items.length;
      results.value = [];
      if (items.length === 0) {
        stage.value = 'empty';
        return;
      }
      engineSession ??= openEngineSession();
      await openExercise(0);
    } catch (caught) {
      error.value = errorText(caught);
      stage.value = 'failed';
    }
  };

  /** Проверка ответа раннером; успех сразу фиксирует попытку. */
  const submit = (answer: unknown) =>
    guarded(async () => {
      const exercise = current.value;
      if (!exercise?.verifiable) return;
      const checked = await engine.practice.submitAnswer({
        attemptId: exercise.attemptId,
        // реактивный Proxy не клонируется при отправке по MessagePort
        answer: toRaw(answer),
      });
      verdict.value = checked;
      if (checked.outcome === 'passed') await complete({});
    });

  const giveUp = () =>
    guarded(async () => {
      await complete({ outcome: 'gave-up' });
      revealed.value = true;
    });

  const reveal = () => {
    revealed.value = true;
  };

  /** Самооценка без раннера; закрепление основ требует явного «Далее». */
  const selfGrade = (grade: Grade) =>
    guarded(async () => {
      await complete({ grade });
      if (remediation.value.length === 0) await advance();
    });

  const next = () => guarded(advance);

  const canStep = () =>
    !busy.value &&
    (stage.value === 'answering' ||
      stage.value === 'reviewed' ||
      stage.value === 'finished');
  const canUndo = computed(() => canStep() && answered.value.length > 0);
  const canRedo = computed(() => canStep() && undone.value.length > 0);

  /** Показывает упражнение плана `index`; за концом плана — итог. */
  const goTo = async (index: number) => {
    if (index >= total.value) {
      stage.value = 'finished';
      finishEngineSession();
      return;
    }
    await openExercise(index);
  };

  /** Снимает последний записанный ответ и возвращает то же упражнение. */
  const undo = async () => {
    const last = answered.value.at(-1);
    if (last === undefined || !canUndo.value) return;
    await guarded(async () => {
      await engine.practice.undo({
        targetId: last.result.eventId,
        requestId: newRequestId(),
      });
      answered.value = answered.value.slice(0, -1);
      results.value = results.value.filter((item) => item !== last.result);
      undone.value = [...undone.value, last];
      await openExercise(last.index);
    });
  };

  /** Возвращает последний отменённый ответ и переходит к следующему упражнению. */
  const redo = async () => {
    const last = undone.value.at(-1);
    if (last === undefined || !canRedo.value) return;
    await guarded(async () => {
      await engine.practice.redo({
        targetId: last.result.eventId,
        requestId: newRequestId(),
      });
      undone.value = undone.value.slice(0, -1);
      answered.value = [...answered.value, last];
      results.value = [...results.value, last.result];
      await goTo(last.index + 1);
    });
  };

  return {
    stage,
    busy,
    error,
    current,
    verdict,
    result,
    remediation,
    revealed,
    position,
    total,
    summary,
    start,
    submit,
    giveUp,
    reveal,
    selfGrade,
    next,
    canUndo,
    canRedo,
    undo,
    redo,
  };
};
