import type {
  ExtensionContext,
  ExtensionModule,
} from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, stateful } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.warn';

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

const command = (name: string) => ({
  id: `${ID}.${name}`,
  title: name,
  description: null,
  category: null,
  keybinding: null,
  keybindings: [],
  when: null,
  icon: 'puzzle',
  palette: true,
});

const exerciseType = (id: string) => ({
  id,
  title: null,
  specSchema: { type: 'object' },
  answerSchema: { type: 'string' },
  rendererUrl: `dolphy-ext://${ID}/view.mjs`,
});

const open = (module: ExtensionModule): Harness => {
  harness = createHarness({
    extensions: [
      stateful(ID, {
        exerciseTypes: [exerciseType(ID), exerciseType(`${ID}.second`)],
        gradePolicies: [
          { id: `${ID}.policy`, label: 'Policy' },
          { id: `${ID}.other`, label: 'Other' },
        ],
        commands: [command('open'), command('ping')],
      }),
    ],
    trusted: [ID],
    modules: { [ID]: module },
  });
  return harness;
};

const warnings = (h: Harness) =>
  h.logger.warn.mock.calls
    .filter(([, message]) => /not registered/.test(String(message)))
    .map(([fields]) => fields as { kind: string; ids: string[] });

describe('вклады, объявленные манифестом, но не зарегистрированные кодом', () => {
  it('после активации лог предупреждает о командах, событиях, видах и правилах', async () => {
    const h = open({
      activate(ctx: ExtensionContext) {
        ctx.commands.register(`${ID}.open`, () => undefined);
        ctx.events.on('attempt.closed', () => undefined);
        ctx.registerExerciseType(ID, {
          project: () => ({}),
          grade: () => ({ outcome: 'passed' }),
        });
        ctx.registerGradePolicy(`${ID}.policy`, () => null);
      },
    });
    await h.commands.invoke(ID, `${ID}.open`, undefined as never);
    expect(warnings(h)).toEqual([
      { extensionId: ID, kind: 'exerciseTypes', ids: [`${ID}.second`] },
      { extensionId: ID, kind: 'gradePolicies', ids: [`${ID}.other`] },
      { extensionId: ID, kind: 'events', ids: ['session.started'] },
      { extensionId: ID, kind: 'commands', ids: [`${ID}.ping`] },
    ]);
  });

  it('когда зарегистрировано всё объявленное, предупреждений нет', async () => {
    const h = open({
      activate(ctx: ExtensionContext) {
        for (const name of ['open', 'ping']) {
          ctx.commands.register(`${ID}.${name}`, () => undefined);
        }
        for (const event of ['attempt.closed', 'session.started'] as const) {
          ctx.events.on(event, () => undefined);
        }
        for (const type of [ID, `${ID}.second`]) {
          ctx.registerExerciseType(type, {
            project: () => ({}),
            grade: () => ({ outcome: 'passed' }),
          });
        }
        for (const policy of ['policy', 'other']) {
          ctx.registerGradePolicy(`${ID}.${policy}`, () => null);
        }
      },
    });
    await h.commands.invoke(ID, `${ID}.open`, undefined as never);
    expect(warnings(h)).toEqual([]);
  });

  it('это предупреждение, а не отказ: зарегистрированная команда работает', async () => {
    const h = open({
      activate(ctx: ExtensionContext) {
        ctx.commands.register(`${ID}.open`, () => 'done');
      },
    });
    await expect(
      h.commands.invoke(ID, `${ID}.open`, undefined as never),
    ).resolves.toBeDefined();
    expect(warnings(h).length).toBeGreaterThan(0);
  });
});
