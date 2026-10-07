import type { ru } from './ru.ts';

export const en: typeof ru = {
  dailyPlan: {
    title: 'Today’s plan',
    total: 'Total in plan: {n}',
    hero: {
      start: 'Start session',
    },
    empty: {
      title: 'Nothing planned for today',
      text: 'All scheduled exercises are done, or the library has no courses yet.',
      scopedText: 'Nothing is planned for today in “{course}”.',
      toCourses: 'Go to courses',
    },
    upcoming: {
      title: 'Up next',
      more: 'and {n} more',
      less: 'Show less',
    },
    remembered: 'Remembered: {n}%',
    rememberedHint: 'Chance that you can recall this right now',
  },
};
