import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { Client } from './support/client.ts';
import { readExtensionData, readJournal } from './support/journal.ts';
import { expectCount, expectVisible } from './support/locator.ts';

const CHOICE = 'Choice (KnowledgeBase)';
const FIXTURES = {
  ordered: 'hooks-extension',
  forbidding: 'hooks-fail-extension',
  invalid: 'hooks-bad-extension',
} as const;
const IDS = {
  ordered: 'acme.hooks',
  forbidding: 'acme.hooks-fail',
  invalid: 'acme.hooks-bad',
} as const;
type Kind = keyof typeof FIXTURES;

const PROMPT_OF: Record<string, string> = {
  'choice_kb::basic::q1': 'Which statement reads data from a table?',
  'choice_kb::basic::q2':
    'Which of these are SQL join types? Select all that apply.',
  'choice_kb::basic::q3': 'Pick the second option.',
};
const RIGHT: Record<string, string[]> = {
  'Which statement reads data from a table?': ['SELECT'],
  'Which of these are SQL join types? Select all that apply.': [
    'INNER',
    'LEFT',
    'FULL',
  ],
  'Pick the second option.': ['b'],
};

const built = new Map<Kind, BuiltExtension>();
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

beforeAll(async () => {
  for (const kind of Object.keys(FIXTURES) as Kind[]) {
    built.set(
      kind,
      await buildFixtureExtension(
        fileURLToPath(new URL(`./fixtures/${FIXTURES[kind]}`, import.meta.url)),
      ),
    );
  }
}, 300_000);

afterAll(async () => {
  for (const extension of built.values()) await extension.dispose();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async (kind: Kind | null) => {
  workspace = await createWorkspace({
    extensions: kind === null ? {} : { [IDS[kind]]: built.get(kind)!.dir },
  });
  app = await launchApp(workspace.userData);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return new Client(app.page);
};

const startChoiceSession = async (client: Client) => {
  await client.openCourses();
  await client.focusCourse(CHOICE);
  await client.startSession();
};

/** Проходит сессию верными ответами и возвращает формулировки в порядке показа. */
const studyChoice = async (client: Client): Promise<string[]> => {
  const shown: string[] = [];
  await client.runSession(({ prompt }) => {
    shown.push(prompt);
    return { choose: RIGHT[prompt] ?? [] };
  });
  return shown;
};

describe('хуки «до» в учебном цикле', () => {
  it('practice.batch: порядок упражнений в сессии переставлен хуком', async () => {
    const client = await launch('ordered');
    await startChoiceSession(client);
    const shown = await studyChoice(client);

    const { storage } = readExtensionData(workspace!.userData, IDS.ordered);
    const original = storage.original as string[];
    expect(original).toHaveLength(3);
    expect(storage.calls).toBeGreaterThanOrEqual(1);
    expect(shown).toEqual(original.toReversed().map((id) => PROMPT_OF[id]));
  });

  it('session.start: отказ расширения показан ошибкой, журнал пуст; после отключения сессия стартует', async () => {
    const client = await launch('forbidding');
    const { page } = client;
    await startChoiceSession(client);
    const alert = page.locator('.v-alert', {
      hasText: 'сессии запрещены в фокус-время',
    });
    await expectVisible(alert);
    await expectCount(page.getByRole('button', { name: 'Проверить' }), 0);
    expect(readJournal(workspace!.userData)).toHaveLength(0);

    // экран сессии без бокового меню: возвращаемся к курсам по маршруту
    await page.evaluate(() => {
      window.location.hash = '#/courses';
    });
    await client.openSettingsExtensions();
    await client.setExtensionSwitch(IDS.forbidding, 'enabled', false);

    // курс уже в фокусе: план открывается из бокового меню
    await client.openPlan();
    await client.startSession();
    const shown = await studyChoice(client);
    expect(shown).toHaveLength(3);
    expect(readJournal(workspace!.userData)).toHaveLength(3);
  });

  it('practice.batch: ответ с несуществующим упражнением отменяет загрузку плана', async () => {
    const client = await launch('invalid');
    const { page } = client;
    await client.openCourses();
    await client.clickStudy(CHOICE);
    // план дня строится тем же хуком: ошибка видна на странице плана
    const alert = page.locator('.v-alert', { hasText: IDS.invalid });
    await expectVisible(alert);
    await expectCount(page.getByText(/Всего в плане: \d+/), 0);
    expect(readJournal(workspace!.userData)).toHaveLength(0);
  });
});
