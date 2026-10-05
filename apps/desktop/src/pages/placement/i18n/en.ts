import type { ru } from './ru.ts';

export const en: typeof ru = {
  placement: {
    title: 'Placement test',
    topBar: {
      exit: 'Exit the test',
      progress: 'Test progress',
    },
    intro: {
      title: 'Let’s see what you already know',
      allCourses: 'All courses',
      lessons: 'no lessons | {n} lesson | {n} lessons',
      questions: 'no questions | {n} question | {n} questions',
      why: 'A few questions about the course topics show what you already know. We mark what you know as done, so you don’t start from scratch, and your daily plan begins with what you really need.',
      how: 'Answer honestly: “I don’t know” is a fine answer. You can finish the test at any time, but the result is saved only when it ends.',
      budget: 'How many questions to ask: at most',
      start: 'Start',
      later: 'Not now',
      empty: {
        title: 'This course has no lessons',
        text: 'There is nothing to check: add lessons to the library and reload it in “Settings → Library”.',
      },
    },
    probe: {
      counter: 'Question {n} of {budget}',
      unresolved:
        'Everything is clear | {n} topic left to sort out | {n} topics left to sort out',
      hint: 'A grade of 3 or higher means “I know it”.',
      back: 'Undo the answer',
      forward: 'Redo the answer',
      next: 'Continue',
      skip: 'I don’t know / skip',
      finishEarly: 'Finish early',
    },
    exit: {
      title: 'Exit the test?',
      text: 'Your answers will not be saved: the result is recorded only when the test ends.',
      stay: 'Stay',
      leave: 'Exit',
    },
    finished: {
      title: 'Here is what you already know',
      known: 'You know',
      uncertain: 'Not sure',
      unknown: 'Not yet known',
      empty: 'Nothing here yet',
      frontier:
        'no lessons ready to learn | {n} lesson ready to learn | {n} lessons ready to learn',
      attempts:
        'No attempts recorded | {n} attempt recorded | {n} attempts recorded',
      duplicate:
        'This result was already saved earlier: no attempts were added again.',
      toPlan: 'Go to daily plan',
      openGraph: 'Open knowledge graph',
      undo: 'Undo the result',
      redo: 'Restore the result',
      undone:
        'The result is undone: the attempts recorded by the test no longer count, and your daily plan starts without them. You can restore it.',
    },
    backToCourses: 'Back to courses',
  },
};
