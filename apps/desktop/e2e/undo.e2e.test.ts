import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { readJournal } from './support/journal.ts';

let workspace: Workspace;
let app: DolphyApp | null = null;
let client: Client;

beforeEach(async () => {
  workspace = await createWorkspace();
  app = await launchApp(workspace.userData);
  client = new Client(app.page);
  await client.openPlan();
  await client.startSession();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
});

const kinds = () =>
  readJournal(workspace.userData).map(({ kind, op }) => `${kind}:${op ?? ''}`);

describe('отмена и возврат ответа в сессии', () => {
  it('Mod+Z снимает ответ записью retract, то же упражнение снова на экране; Mod+Shift+Z возвращает', async () => {
    const first = await client.currentExercise();
    expect(await client.answerHistory()).toEqual({
      canUndo: false,
      canRedo: false,
    });

    await client.gradeCurrent(5);
    await expect.poll(kinds).toEqual(['attempt:']);
    await expect
      .poll(() => client.answerHistory())
      .toEqual({ canUndo: true, canRedo: false });

    await client.undoAnswer('keyboard');
    await expect.poll(kinds).toEqual(['attempt:', 'retract:set']);
    expect((await client.currentExercise()).prompt).toBe(first.prompt);
    await expect
      .poll(() => client.answerHistory())
      .toEqual({ canUndo: false, canRedo: true });

    await client.redoAnswer('keyboard');
    await expect
      .poll(kinds)
      .toEqual(['attempt:', 'retract:set', 'retract:unset']);
    await expect
      .poll(() => client.answerHistory())
      .toEqual({ canUndo: true, canRedo: false });
  });

  it('кнопки шапки делают то же, а новый ответ после отмены сбрасывает «вернуть»', async () => {
    await client.gradeCurrent(4);
    await expect.poll(kinds).toEqual(['attempt:']);

    await client.undoAnswer('button');
    await expect.poll(kinds).toEqual(['attempt:', 'retract:set']);
    await expect
      .poll(() => client.answerHistory())
      .toEqual({ canUndo: false, canRedo: true });

    await client.gradeCurrent(3);
    await expect.poll(kinds).toEqual(['attempt:', 'retract:set', 'attempt:']);
    await expect
      .poll(() => client.answerHistory())
      .toEqual({ canUndo: true, canRedo: false });
  });
});
