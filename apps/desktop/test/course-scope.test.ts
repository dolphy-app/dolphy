import { describe, expect, it, vi } from 'vitest';
import type {
  CourseDto,
  EngineEvent,
  LearningEngine,
  ProgressNodeDto,
  UiSettingsDto,
  UiSettingsPatch,
} from '@dolphy-app/engine-contract';
import { loadCourses } from '@/entities/course';
import { createCourseScope } from '@/features/course-scope/model/course-scope.ts';

const courseDto = (id: string): CourseDto => ({
  kind: 'course',
  id,
  name: id.toUpperCase(),
  lessonCount: 3,
  metadata: {},
  dependencies: [],
  encompassed: [],
  superseded: [],
});

interface FakeState {
  courses: string[];
  /** Уроки по курсам (id узлов прогресса уроков). */
  lessons?: Record<string, string[]>;
  progress: ProgressNodeDto[];
  ui: UiSettingsDto;
  failSetUi?: boolean;
}

const createFake = (state: FakeState) => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const setUi = vi.fn(async (patch: UiSettingsPatch) => {
    if (state.failSetUi) throw new Error('disk is full');
    const { activeCourseId, theme, locale } = patch;
    const { activeCourseId: current, ...ui } = state.ui;
    const next = activeCourseId === undefined ? current : activeCourseId;
    state.ui = {
      ...ui,
      ...(theme !== undefined && { theme }),
      ...(locale !== undefined && { locale }),
      ...(next !== undefined && next !== null && { activeCourseId: next }),
    };
    return state.ui;
  });
  const engine = {
    library: {
      listCourses: async () => ({ items: state.courses.map(courseDto) }),
      listLessons: async (courseId: string) => ({
        items: state.lessons?.[courseId]?.map((id) => ({ id })) ?? [],
      }),
    },
    practice: { getProgress: async () => ({ items: state.progress }) },
    settings: { getUi: async () => state.ui, setUi },
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as LearningEngine;
  const emit = (event: EngineEvent) => listeners.forEach((run) => run(event));
  return { engine, setUi, emit, state };
};

const node = (
  id: string,
  extra: Partial<ProgressNodeDto> = {},
): ProgressNodeDto => ({
  id,
  kind: 'course',
  status: 'in-progress',
  score: 2.5,
  avgTrials: 1,
  attempts: 4,
  dueExercises: 3,
  ...extra,
});

const ui = (activeCourseId?: string): UiSettingsDto => ({
  theme: 'system',
  locale: 'system',
  ...(activeCourseId !== undefined && { activeCourseId }),
});

describe('loadCourses', () => {
  it('counts mastered lessons per course; a course without progress is a fresh one', async () => {
    const { engine } = createFake({
      courses: ['git', 'sql', 'js'],
      lessons: { git: ['git::a', 'git::b', 'git::c'], sql: ['sql::a'] },
      progress: [
        node('git'),
        node('git::a', { kind: 'lesson', status: 'mastered' }),
        node('git::b', { kind: 'lesson', status: 'in-progress' }),
        node('git::c', { kind: 'lesson', status: 'mastered' }),
        node('sql', { status: 'ready', dueExercises: 0 }),
      ],
      ui: ui(),
    });
    const [git, sql, js] = await loadCourses(engine);
    expect(git).toMatchObject({
      id: 'git',
      lessonsDone: 2,
      due: 3,
      attempts: 4,
    });
    expect(sql).toMatchObject({ lessonsDone: 0, status: 'ready', due: 0 });
    expect(js).toMatchObject({
      id: 'js',
      lessonsDone: 0,
      status: 'ready',
      attempts: 0,
    });
  });
});

describe('createCourseScope', () => {
  it('starts with the saved course and hands it to requests as courseIds', async () => {
    const { engine } = createFake({
      courses: ['git', 'js'],
      progress: [],
      ui: ui('js'),
    });
    const scope = await createCourseScope(engine);
    expect(scope.activeId.value).toBe('js');
    expect(scope.active.value?.name).toBe('JS');
    expect(scope.courseIds.value).toEqual(['js']);
  });

  it('without a saved course all courses are in scope', async () => {
    const { engine } = createFake({ courses: ['git'], progress: [], ui: ui() });
    const scope = await createCourseScope(engine);
    expect(scope.activeId.value).toBeNull();
    expect(scope.courseIds.value).toBeUndefined();
  });

  it('drops the focus on a course that left the library, also in the settings', async () => {
    const fake = createFake({ courses: ['git'], progress: [], ui: ui('gone') });
    const scope = await createCourseScope(fake.engine);
    expect(scope.activeId.value).toBeNull();
    expect(fake.setUi).toHaveBeenCalledWith({ activeCourseId: null });
    expect(fake.state.ui.activeCourseId).toBeUndefined();
  });

  it('keeps the saved focus while the library has no courses (it may be broken, not emptied)', async () => {
    const fake = createFake({ courses: [], progress: [], ui: ui('git') });
    const scope = await createCourseScope(fake.engine);
    expect(scope.activeId.value).toBeNull();
    expect(fake.setUi).not.toHaveBeenCalled();
  });

  it('select saves the choice; null returns to all courses', async () => {
    const fake = createFake({ courses: ['git', 'js'], progress: [], ui: ui() });
    const scope = await createCourseScope(fake.engine);
    await scope.select('git');
    expect(scope.courseIds.value).toEqual(['git']);
    expect(fake.state.ui.activeCourseId).toBe('git');
    await scope.select(null);
    expect(scope.courseIds.value).toBeUndefined();
    expect(fake.state.ui.activeCourseId).toBeUndefined();
  });

  it('select rolls back and reports when the choice cannot be saved', async () => {
    const fake = createFake({
      courses: ['git', 'js'],
      progress: [],
      ui: ui('git'),
    });
    const scope = await createCourseScope(fake.engine);
    fake.state.failSetUi = true;
    await scope.select('js');
    expect(scope.activeId.value).toBe('git');
    expect(scope.error.value).toBe('disk is full');
  });

  it('refreshes due counts when progress changes', async () => {
    const fake = createFake({
      courses: ['git'],
      progress: [node('git', { dueExercises: 1 })],
      ui: ui(),
    });
    const scope = await createCourseScope(fake.engine);
    expect(scope.courses.value[0]?.due).toBe(1);
    fake.state.progress = [node('git', { dueExercises: 7 })];
    fake.emit({ type: 'progress', unitIds: ['git'], at: 0 });
    await vi.waitFor(() => expect(scope.courses.value[0]?.due).toBe(7));
  });
});
