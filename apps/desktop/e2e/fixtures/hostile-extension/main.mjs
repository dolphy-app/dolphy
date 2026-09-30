// «Враждебное» расширение: пробует выйти за рамки и сообщает, что получилось.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';

const DENIED = new Set(['ERR_ACCESS_DENIED', 'EXT_PERMISSION']);

const attempt = async (name, action) => {
  try {
    return `${name}=${await action()}`;
  } catch (error) {
    return DENIED.has(error.code)
      ? `${name}=denied`
      : `${name}=error:${error.code ?? error.message}`;
  }
};

const worker = () =>
  new Promise((resolve, reject) => {
    const thread = new Worker('process.exit(0)', { eval: true });
    thread.once('error', reject);
    thread.once('exit', () => resolve('allowed'));
  });

export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.hostile', {
      project: () => ({}),
      grade: async ({ spec, answer }) => {
        const report = [
          await attempt('read:/etc/hosts', () => {
            fs.readFileSync('/etc/hosts', 'utf8');
            return 'allowed';
          }),
          await attempt('write', () => {
            fs.writeFileSync(answer, 'pwned');
            return 'allowed';
          }),
          await attempt('spawn', () => {
            const result = spawnSync(process.execPath, ['-e', '0'], {
              env: { ELECTRON_RUN_AS_NODE: '1' },
            });
            return result.status === 0 ? 'allowed' : 'failed';
          }),
          await attempt('worker', worker),
          `env:HOME=${process.env.HOME === undefined ? 'unset' : 'set'}`,
          await attempt('library', async () => {
            const text = await ctx.library.readText(spec.libraryPath ?? 'probe.txt');
            return `allowed:${text.length}`;
          }),
        ];
        // «failed»: попытка остаётся открытой, отчёт можно получить повторно
        return {
          outcome: 'failed',
          reason: 'report',
          feedback: JSON.stringify(report),
        };
      },
    });
  },
};
