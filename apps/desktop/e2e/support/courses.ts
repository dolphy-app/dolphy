/** Курс из одного упражнения: `front` — всё после frontmatter. */
export const course = (id: string, name: string, front: string) => ({
  [`${id}/course_manifest.json`]: JSON.stringify({
    dependencies: [],
    description: name,
    engine: { tags: [id] },
    generator_config: { KnowledgeBase: {} },
    id,
    name,
  }),
  [`${id}/basic.lesson/lesson.name.json`]: JSON.stringify('Frames'),
  [`${id}/basic.lesson/q1.front.md`]: front,
  [`${id}/basic.lesson/q1.back.md`]: 'Answer\n',
});

export const exerciseFront = (type: string, spec: string[], prompt: string) =>
  [
    '---',
    'engine:',
    '  exercise:',
    `    type: ${type}`,
    ...spec,
    '---',
    prompt,
    '',
  ].join('\n');

export const ECHO = 'Echo (KnowledgeBase)';

/** Упражнение вида `acme.echo` из расширения-фикстуры `echo-extension`. */
export const ECHO_COURSE = course(
  'echo_kb',
  ECHO,
  exerciseFront(
    'acme.echo',
    ['    spec:', '      expected: "42"'],
    'What is the answer to everything?',
  ),
);

export const MARKDOWN = 'Frames (KnowledgeBase)';

/** Курс, в условии которого блок кода на языке `language`. */
export const markdownCourse = (language: string) =>
  course(
    'frames_kb',
    MARKDOWN,
    ['Blocks', '', `\`\`\`${language}`, 'hello', '```', ''].join('\n'),
  );
