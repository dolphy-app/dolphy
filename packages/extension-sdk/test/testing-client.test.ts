import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import {
  INJECTION_LIMITS,
  anchorSelector,
  defineClient,
} from '../src/index.ts';
import { createTestClient } from '../src/testing.ts';

const component = defineComponent({});

describe('createTestClient', () => {
  it('records what the entry adds', async () => {
    const run = () => undefined;
    const client = await createTestClient(
      defineClient((c) => {
        c.addPanel({ id: 'a.panel', title: 'Panel', component });
        c.addInjection({
          id: 'a.plan',
          target: anchorSelector('dailyPlan'),
          component,
        });
        c.addAnswerView('a.type', component);
        c.addMarkdownRenderer('chart', component);
        c.addTheme({ id: 'a.dark', label: 'Dark', dark: true, colors: {} });
        c.addCommand({ id: 'a.go', title: 'Go', run });
      }),
    );

    expect(client.panels.map(({ id }) => id)).toEqual(['a.panel']);
    expect(client.injections).toEqual([
      {
        id: 'a.plan',
        target: anchorSelector('dailyPlan'),
        position: 'append',
        component,
      },
    ]);
    expect(client.answerViews.get('a.type')).toBe(component);
    expect(client.markdownRenderers.get('chart')).toBe(component);
    expect(client.themes.map(({ id }) => id)).toEqual(['a.dark']);
    expect(client.commands.map(({ id }) => id)).toEqual(['a.go']);
  });

  it('refuses an id added twice, a bad language and a bad injection', async () => {
    await expect(
      createTestClient(
        defineClient((c) => {
          c.addPanel({ id: 'a.p', title: 'P', component });
          c.addPanel({ id: 'a.p', title: 'P', component });
        }),
      ),
    ).rejects.toThrow("panel 'a.p' is already added");
    await expect(
      createTestClient(
        defineClient((c) => {
          c.addMarkdownRenderer('Bad Lang', component);
        }),
      ),
    ).rejects.toThrow(/not valid/);
    await expect(
      createTestClient(
        defineClient((c) => {
          c.addInjection({ id: 'a.empty', target: '', component });
        }),
      ),
    ).rejects.toThrow(/injection target/);
    await expect(
      createTestClient(
        defineClient((c) => {
          c.addInjection({
            id: 'a.long',
            target: 'a'.repeat(INJECTION_LIMITS.selectorLength + 1),
            component,
          });
        }),
      ),
    ).rejects.toThrow(/injection target/);
    await expect(
      createTestClient(
        defineClient((c) => {
          c.addInjection({ id: 'a.i', target: 'body', component });
          c.addInjection({ id: 'a.i', target: 'body', component });
        }),
      ),
    ).rejects.toThrow("injection 'a.i' is already added");
  });

  it('checks the id prefix once extensionId is given', async () => {
    await expect(
      createTestClient(
        defineClient((c) => {
          c.addCommand({ id: 'other.go', title: 'Go', run: () => undefined });
        }),
        { extensionId: 'acme' },
      ),
    ).rejects.toThrow(
      "command id 'other.go' must be 'acme' or start with 'acme.'",
    );
  });

  it('a disposed addition is gone; dispose runs the cleanup', async () => {
    let cleaned = false;
    const client = await createTestClient(
      defineClient((c) => {
        c.addPanel({ id: 'a.p', title: 'P', component }).dispose();
        c.addTheme({ id: 'a.t', label: 'T', dark: false, colors: {} });
        return () => {
          cleaned = true;
        };
      }),
    );
    expect(client.panels).toEqual([]);
    await client.dispose();
    expect(client.themes).toEqual([]);
    expect(cleaned).toBe(true);
  });
});
