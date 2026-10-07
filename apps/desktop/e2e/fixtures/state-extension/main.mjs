// Расширение с состоянием: считает события обучения в s.storage и показывает
// настройки и счётчики в «отчёте» — отзыве проверки на ответ `report`.
let changes = 0;
let reports = 0;

export const server = (s) => {
  const count = async (key) => (await s.storage.get(key)) ?? 0;
  const bump = async (key) => s.storage.set(key, (await count(key)) + 1);

  const report = async () => {
    reports += 1;
    return {
      reports,
      started: await count('started'),
      finished: await count('finished'),
      closed: await count('closed'),
      last: (await s.storage.get('last')) ?? null,
      changes,
      greeting: s.settings.get('acme.state.greeting'),
      loud: s.settings.get('acme.state.loud'),
      limit: s.settings.get('acme.state.limit'),
      mode: s.settings.get('acme.state.mode'),
    };
  };

  // запись, не помещающаяся в потолок значения (64 КиБ): отчёт сообщает, что получилось
  const overflow = async () => {
    try {
      await s.storage.set('big', 'x'.repeat(70 * 1024));
      return { quota: 'accepted' };
    } catch (error) {
      return {
        quota: error.name,
        quotaKind: error.kind,
        quotaLimit: error.limit,
      };
    }
  };

  s.registerSettings([
    {
      id: 'acme.state.greeting',
      type: 'string',
      label: 'Приветствие',
      description: 'Что расширение пишет в отчёте',
      default: 'привет',
      maxLength: 12,
    },
    {
      id: 'acme.state.loud',
      type: 'boolean',
      label: 'Громко',
      default: false,
    },
    {
      id: 'acme.state.limit',
      type: 'number',
      label: 'Предел',
      default: 3,
      min: 1,
      max: 10,
      integer: true,
    },
    {
      id: 'acme.state.mode',
      type: 'enum',
      label: 'Режим',
      default: 'calm',
      options: [
        { value: 'calm', label: 'Спокойный' },
        { value: 'brisk', label: 'Бодрый' },
      ],
    },
    { id: 'acme.state.note', type: 'string', label: 'Заметка', default: '' },
  ]);
  s.settings.onDidChange(() => {
    changes += 1;
  });
  s.on('session.started', () => bump('started'));
  s.on('session.finished', () => bump('finished'));
  s.on('attempt.closed', async ({ exerciseId, grade, outcome }) => {
    await bump('closed');
    await s.storage.set('last', { exerciseId, grade, outcome });
  });
  s.registerExerciseType({
    id: 'acme.state',
    specSchema: { type: 'object' },
    answerSchema: { type: 'string' },
    project: () => ({ greeting: s.settings.get('acme.state.greeting') }),
    grade: async ({ answer }) => {
      if (answer === 'pass') return { outcome: 'passed' };
      const body = answer === 'quota' ? await overflow() : {};
      // «failed»: попытка остаётся открытой, отчёт можно получить повторно
      return {
        outcome: 'failed',
        reason: 'report',
        feedback: JSON.stringify({ ...body, ...(await report()) }),
      };
    },
  });
};
