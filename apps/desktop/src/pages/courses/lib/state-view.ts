import type { CourseState } from '../model/courses-view.ts';

interface StateView {
  icon: string;
  /** Цвет темы Vuetify для значка; подпись остаётся нейтральной (контраст текста). */
  color: string;
}

/** Как показываем состояние курса; подпись — сообщение `courses.state.<состояние>`. */
export const COURSE_STATE_VIEW: Record<CourseState, StateView> = {
  'not-started': { icon: 'mdi-circle-outline', color: 'on-surface-variant' },
  'in-progress': { icon: 'mdi-progress-clock', color: 'primary' },
  completed: { icon: 'mdi-check-circle', color: 'success' },
  locked: { icon: 'mdi-lock-outline', color: 'on-surface-variant' },
  hidden: { icon: 'mdi-eye-off-outline', color: 'on-surface-variant' },
  superseded: { icon: 'mdi-swap-horizontal', color: 'on-surface-variant' },
};
