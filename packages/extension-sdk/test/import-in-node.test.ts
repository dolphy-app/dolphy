// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('importing extension code without a DOM', () => {
  it('defining views, panels and renderers touches no DOM globals', async () => {
    expect(typeof document).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
    const sdk = await import('../src/index.ts');
    const view = sdk.defineAnswerView(() => ({ update() {} }));
    const panel = sdk.defineExtensionPanel({ mount() {} });
    const renderer = sdk.defineMarkdownRenderer(() => undefined);
    expect(typeof view.mount).toBe('function');
    expect(typeof panel.mount).toBe('function');
    expect(typeof renderer.render).toBe('function');
  });
});
