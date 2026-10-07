// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

describe('importing extension code without a DOM', () => {
  it('defining entries touches no DOM globals', async () => {
    expect(typeof document).toBe('undefined');
    const sdk = await import('../src/index.ts');
    const component = defineComponent({});
    const added: unknown[] = [];
    const entry = sdk.defineClient((client) => {
      client.addInjection({
        id: 'a.plan',
        target: sdk.anchorSelector('dailyPlan'),
        component,
      });
      added.push(client.extensionId);
    });
    await entry({
      extensionId: 'a',
      app: {} as never,
      engine: {} as never,
      addPanel: () => ({ dispose: () => undefined }),
      addInjection: (reg) => {
        added.push(reg.component);
        return { dispose: () => undefined };
      },
      addAnswerView: () => ({ dispose: () => undefined }),
      addMarkdownRenderer: () => ({ dispose: () => undefined }),
      addTheme: () => ({ dispose: () => undefined }),
      addCommand: () => ({ dispose: () => undefined }),
    });
    expect(added).toEqual([component, 'a']);
    const server = sdk.defineServer(() => undefined);
    expect(typeof server).toBe('function');
  });
});
