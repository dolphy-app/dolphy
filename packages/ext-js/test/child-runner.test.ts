import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChildRunner } from '../src/child-runner.ts';
import type { ChildRunner } from '../src/child-runner.ts';
import { childPids } from './helpers.ts';

const request = { code: '', tests: '', timeoutMs: 1000, maxOutputChars: 100 };

let dir = '';
const runners: ChildRunner[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ext-js-runner-'));
});
afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.close()));
  await rm(dir, { recursive: true, force: true });
});

const runnerFor = async (source: string) => {
  const file = join(dir, 'worker.mjs');
  await writeFile(file, source);
  const runner = createChildRunner(file);
  runners.push(runner);
  return runner;
};

describe('раннер дочерних процессов', () => {
  it('процесс, умерший до готовности, — worker_crash', async () => {
    const runner = await runnerFor('process.exit(3);');
    expect(await runner.run(request)).toEqual({
      kind: 'crash',
      reason: 'worker_crash',
    });
  });

  it('процесс, умерший после запроса без ответа, — worker_crash', async () => {
    const runner = await runnerFor(
      "process.on('message', () => process.exit(4)); process.send({ type: 'ready' });",
    );
    expect(await runner.run(request)).toEqual({
      kind: 'crash',
      reason: 'worker_crash',
    });
    expect(childPids()).toEqual([]);
  });

  it('ответ неверной формы — worker_bad_result', async () => {
    const runner = await runnerFor(
      "process.on('message', () => process.send({ type: 'result', result: 1 })); process.send({ type: 'ready' });",
    );
    expect(await runner.run(request)).toEqual({
      kind: 'crash',
      reason: 'worker_bad_result',
    });
  });

  it('зависший процесс убивается по timeoutMs', async () => {
    const runner = await runnerFor(
      "process.on('message', () => { for (;;); }); process.send({ type: 'ready' });",
    );
    expect(await runner.run({ ...request, timeoutMs: 300 })).toEqual({
      kind: 'timeout',
    });
    expect(childPids()).toEqual([]);
  });

  it('после close новые запросы получают stopped', async () => {
    const runner = await runnerFor('process.exit(0);');
    await runner.close();
    expect(await runner.run(request)).toEqual({
      kind: 'crash',
      reason: 'stopped',
    });
  });
});
