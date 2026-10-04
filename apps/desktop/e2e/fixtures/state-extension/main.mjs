// Расширение с состоянием: считает события обучения в ctx.storage и показывает
// настройки и счётчики в «отчёте» — отзыве проверки на ответ `report`.
let ctx = null;
let changes = 0;
let reports = 0;

const count = async (key) => (await ctx.storage.get(key)) ?? 0;
const bump = async (key) => ctx.storage.set(key, (await count(key)) + 1);

const report = async () => {
  reports += 1;
  return {
    reports,
    activations: await count('activations'),
    started: await count('started'),
    finished: await count('finished'),
    closed: await count('closed'),
    last: (await ctx.storage.get('last')) ?? null,
    changes,
    greeting: ctx.settings.get('acme.state.greeting'),
    loud: ctx.settings.get('acme.state.loud'),
    limit: ctx.settings.get('acme.state.limit'),
    mode: ctx.settings.get('acme.state.mode'),
  };
};

// запись, не помещающаяся в потолок значения (64 КиБ): отчёт сообщает, что получилось
const overflow = async () => {
  try {
    await ctx.storage.set('big', 'x'.repeat(70 * 1024));
    return { quota: 'accepted' };
  } catch (error) {
    return {
      quota: error.name,
      quotaKind: error.kind,
      quotaLimit: error.limit,
    };
  }
};

export default {
  async activate(context) {
    ctx = context;
    ctx.settings.onDidChange(() => {
      changes += 1;
    });
    ctx.events.on('session.started', () => bump('started'));
    ctx.events.on('session.finished', () => bump('finished'));
    ctx.events.on('attempt.closed', async ({ exerciseId, grade, outcome }) => {
      await bump('closed');
      await ctx.storage.set('last', { exerciseId, grade, outcome });
    });
    ctx.registerExerciseType('acme.state', {
      project: () => ({ greeting: ctx.settings.get('acme.state.greeting') }),
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
    await bump('activations');
  },
};
