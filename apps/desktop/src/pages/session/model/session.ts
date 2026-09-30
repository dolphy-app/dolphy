import { computed, ref, shallowRef } from 'vue';
import type {
  CompleteAttemptRequest,
  Grade,
  ItemReason,
  LearningEngine,
  PlanItemDto,
  RecordResultDto,
  SubmissionDto,
  UnitId,
  VerdictDto,
} from '@lms/engine-contract';
import { PLAN_MAX_ITEMS } from '@/shared/config/plan.ts';
import {
  readExerciseContent,
  readOptionalText,
} from '../api/read-exercise-content.ts';

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
  /** Что вводит ученик: `sql` для раннера SQL, иначе текст. */
  submissionKind: 'sql' | 'text';
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
}

const PASSING_GRADE = 3;

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

const submissionOf = (
  kind: CurrentExercise['submissionKind'],
  text: string,
): SubmissionDto =>
  kind === 'sql' ? { kind: 'sql', sql: text } : { kind: 'text', text };

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
  let items: PlanItemDto[] = [];

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
      submissionKind: exercise.verification?.runner === 'sql' ? 'sql' : 'text',
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
      await openExercise(0);
    } catch (caught) {
      error.value = errorText(caught);
      stage.value = 'failed';
    }
  };

  /** Проверка ответа раннером; успех сразу фиксирует попытку. */
  const submit = (text: string) =>
    guarded(async () => {
      const exercise = current.value;
      if (!exercise?.verifiable) return;
      const checked = await engine.practice.submitAnswer({
        attemptId: exercise.attemptId,
        submission: submissionOf(exercise.submissionKind, text),
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
  };
};
