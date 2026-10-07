// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

describe('importing extension code without a DOM', () => {
  it('defining views, panels and renderers touches no DOM globals', async () => {
    expect(typeof document).toBe('undefined');
    const sdk = await import('../src/index.ts');
    const component = defineComponent({});
    expect(sdk.defineAnswerView(component)).toBe(component);
    expect(sdk.defineExtensionPanel(component)).toBe(component);
    expect(sdk.defineExtensionWidget(component)).toBe(component);
    expect(sdk.defineMarkdownRenderer(component)).toBe(component);
  });
});
