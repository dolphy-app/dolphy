// Расширение-фикстура импорта и экспорта.
// Файл `.words`: первая строка — id курса, вторая — название, остальные — вопросы (по строке на упражнение).
// Курс с id `broken` содержит упражнение с незакрытым frontmatter: компилятор отвергает его (E_FRONTMATTER_UNTERMINATED).
const courseFiles = (text) => {
  const [id, name, ...questions] = text.split('\n').map((line) => line.trim());
  const front = (question) =>
    id === 'broken'
      ? [
          '---',
          'engine:',
          '  exercise:',
          '    type: choice',
          question,
          '',
        ].join('\n')
      : `${question}\n`;
  const files = {
    [`${id}/course_manifest.json`]: JSON.stringify({
      dependencies: [],
      description: name,
      engine: { tags: [id] },
      generator_config: { KnowledgeBase: {} },
      id,
      name,
    }),
    [`${id}/basic.lesson/lesson.name.json`]: JSON.stringify('Слова'),
  };
  questions
    .filter((question) => question !== '')
    .forEach((question, index) => {
      files[`${id}/basic.lesson/q${index + 1}.front.md`] = front(question);
      files[`${id}/basic.lesson/q${index + 1}.back.md`] = 'Ответ\n';
    });
  return files;
};

export default {
  activate(ctx) {
    ctx.importers.register('acme.transfers.words', ({ text }) => ({
      files: courseFiles(text),
    }));
    ctx.importers.register('acme.transfers.hang', () => new Promise(() => {}));
    ctx.exporters.register('acme.transfers.course', (input) => ({
      filename: `${input.courseId}.json`,
      text: JSON.stringify({
        title: input.title,
        files: Object.keys(input.files).sort(),
      }),
    }));
    ctx.exporters.register('acme.transfers.progress', async () => ({
      filename: 'progress.json',
      text: JSON.stringify({ streak: await ctx.stats.streak() }),
    }));
  },
};
