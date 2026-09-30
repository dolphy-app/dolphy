import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { readJournal, readSetting } from './support/journal.ts';

const CHOICE = 'Choice (KnowledgeBase)';
const POLICY_EXTENSION = fileURLToPath(
  new URL('./fixtures/policy-extension', import.meta.url),
);

const RIGHT: Record<string, string[]> = {
  'Which statement reads data from a table?': ['SELECT'],
  'Which of these are SQL join types? Select all that apply.': [
    'INNER',
    'LEFT',
    'FULL',
  ],
  'Pick the second option.': ['b'],
};
const WRONG: Record<string, string[]> = {
  'Which statement reads data from a table?': ['GROUP'],
  'Which of these are SQL join types? Select all that apply.': ['FORWARD'],
  'Pick the second option.': ['a'],
};
const UNIT_OF: Record<string, string> = {
  'Which statement reads data from a table?': 'choice_kb::basic::q1',
  'Which of these are SQL join types? Select all that apply.':
    'choice_kb::basic::q2',
  'Pick the second option.': 'choice_kb::basic::q3',
};

let workspace: Workspace;
let app: DolphyApp | null = null;
let client: Client;

const start = async () => {
  app = await launchApp(workspace.userData);
  client = new Client(app.page);
};

const stop = async () => {
  await app?.close();
  app = null;
};

/**
 * Сессия по курсу choice: на первом упражнении сначала неверный ответ, затем
 * верный (pass@2), остальные — верно с первого раза. Возвращает оценку
 * упражнения с повторной попыткой.
 */
const studyChoice = async (): Promise<number | null> => {
  await client.openCourses();
  await client.focusCourse(CHOICE);
  await client.startSession();
  const first = await client.currentExercise();
  await client.submitWrong({ choose: WRONG[first.prompt] ?? [] });
  const summary = await client.runSession(({ prompt }) => ({
    choose: RIGHT[prompt] ?? [],
  }));
  expect(summary.count).toBe(3);
  const journal = readJournal(workspace.userData);
  expect(journal).toHaveLength(3);
  const retried = journal.find((row) => row.unit_id === UNIT_OF[first.prompt]);
  return retried?.grade ?? null;
};

beforeEach(async () => {
  workspace = await createWorkspace({
    extensions: { 'acme.policy': POLICY_EXTENSION },
  });
});

afterEach(async () => {
  await stop();
  await workspace?.dispose();
});

describe('правило оценки из расширения', () => {
  it('по умолчанию действует Pass@N: со второй попытки — 4', async () => {
    await start();
    await client.openSettingsLearning();
    expect(await client.selectedGradePolicy()).toBe('Pass@N');
    expect(await studyChoice()).toBe(4);
  });

  it('выбранное правило «Generous» ставит 5 за тот же ответ и сохраняется в БД', async () => {
    await start();
    await client.openSettingsLearning();
    await client.selectGradePolicy('Generous');
    await expect
      .poll(() => readSetting(workspace.userData, 'learning'))
      .toEqual({ gradePolicy: 'acme.policy.generous' });

    expect(await studyChoice()).toBe(5);
    for (const row of readJournal(workspace.userData)) {
      expect(row.source).toBe('runner');
    }
  });

  it('возврат к встроенному правилу снова даёт 4', async () => {
    await start();
    await client.openSettingsLearning();
    await client.selectGradePolicy('Generous');
    await client.selectGradePolicy('Pass@N');
    await expect
      .poll(() => readSetting(workspace.userData, 'learning'))
      .toEqual({ gradePolicy: 'passAtN' });
    expect(await studyChoice()).toBe(4);
  });

  it('расширение убрали, выбор сохранён: предупреждение, оценка по Pass@N, без экрана ошибки', async () => {
    await start();
    await client.openSettingsLearning();
    await client.selectGradePolicy('Generous');
    await expect
      .poll(() => readSetting(workspace.userData, 'learning'))
      .toEqual({ gradePolicy: 'acme.policy.generous' });
    await stop();
    await rm(join(workspace.userData, 'extensions', 'acme.policy'), {
      recursive: true,
    });

    await start();
    await client.openSettingsLearning();
    expect(await client.gradePolicyWarning()).toContain('недоступно');
    expect(await client.selectedGradePolicy()).toBe('Pass@N');

    expect(await studyChoice()).toBe(4);
    expect(readSetting(workspace.userData, 'learning')).toEqual({
      gradePolicy: 'acme.policy.generous',
    });
  });
});
