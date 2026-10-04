// Расширение с богатыми настройками: вид задания отвечает отчётом о значениях
// настроек, какими их видит код (`failed` оставляет попытку открытой).
let ctx = null;
let changes = 0;

const report = () => ({
  changes,
  advanced: ctx.settings.get('acme.rich.advanced'),
  note: ctx.settings.get('acme.rich.note'),
  tags: ctx.settings.get('acme.rich.tags'),
  tint: ctx.settings.get('acme.rich.tint'),
  secret: ctx.settings.get('acme.rich.secret'),
});

export default {
  async activate(context) {
    ctx = context;
    ctx.settings.onDidChange(() => {
      changes += 1;
    });
    ctx.registerExerciseType('acme.rich', {
      project: () => ({}),
      grade: async () => ({
        outcome: 'failed',
        reason: 'report',
        feedback: JSON.stringify(report()),
      }),
    });
  },
};
