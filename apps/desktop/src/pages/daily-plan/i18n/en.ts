import type { ru } from './ru.ts';

export const en: typeof ru = {
  dailyPlan: {
    title: 'Today’s plan',
    hero: {
      start: 'Start session',
    },
    empty: {
      title: 'Nothing planned for today',
      text: 'All scheduled exercises are done, or the library has no courses yet.',
    },
    upcoming: {
      title: 'Up next',
      total: 'Total in plan: {n}',
      more: 'and {n} more',
      empty: 'No other exercises in the plan.',
    },
    due: {
      title: 'Due for review',
      empty: 'Nothing to review yet.',
    },
  },
};
