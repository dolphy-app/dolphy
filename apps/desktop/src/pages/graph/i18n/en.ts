import type { ru } from './ru.ts';

export const en: typeof ru = {
  graph: {
    title: 'Knowledge graph',
    subtitle: 'Lessons and how they connect: what to master first',
    showCovers: 'Show coverage',
    canvas: 'Lesson graph',
    truncated:
      'Showing part of the graph: the selected courses have more lessons than fit on the diagram.',
    noDependencies:
      'There are no dependencies between lessons, so lessons are shown as a grid. Links appear once the course author says what comes before what.',
    empty: {
      noCourses: {
        title: 'No courses yet',
        text: 'Add courses to the library and reload it in “Settings → Library”.',
      },
      noLessons: {
        title: 'This course has no lessons',
        text: 'The graph is built from lessons: add some to the course and reload the library.',
      },
    },
    controls: {
      label: 'Zoom controls',
      fit: 'Fit graph to window',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
    },
    legend: {
      title: 'Lesson statuses',
    },
    status: {
      locked: 'Locked',
      ready: 'Ready to learn',
      'in-progress': 'In progress',
      mastered: 'Mastered',
      blacklisted: 'Hidden',
      superseded: 'Superseded',
    },
    statusHint: {
      locked: 'Prerequisites are not met yet',
      ready: 'Prerequisites are met, you can start',
      'in-progress': 'Has attempts, score is still below the threshold',
      mastered: 'Score passed the threshold',
      blacklisted: 'The lesson is hidden from learning',
      superseded: 'The lesson is replaced by another one',
    },
    frame: {
      mastered: 'Lessons mastered: {done} of {total}',
    },
    node: {
      score: 'Score {score} of 5',
      noScore: 'No score',
      due: 'nothing to review | {n} to review | {n} to review',
      aria: '{name}: {status}. {score}. {due}',
    },
    edge: {
      weight: 'Coverage {weight}',
    },
    panel: {
      label: 'Lesson details',
      close: 'Close',
      course: 'Course',
      status: 'Status',
      score: 'Score',
      attempts: 'Attempts',
      scoreValue: '{score} of 5',
      attemptsCount: 'no attempts | {n} attempt | {n} attempts',
      due: 'To review',
      prerequisites: 'Prerequisites',
      noPrerequisites: 'None: you can start this lesson from scratch',
      encompasses: 'What it covers',
      noEncompasses: 'Covers nothing',
      covered: 'weight {weight}',
      openLesson: 'Open {name}',
      study: 'Study',
      studyLocked: 'Meet the prerequisites first',
      studyUnavailable:
        'The lesson is hidden or superseded and cannot be studied',
    },
  },
};
