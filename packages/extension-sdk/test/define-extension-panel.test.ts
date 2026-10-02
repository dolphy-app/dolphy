import { describe, expect, it, vi } from 'vitest';
import {
  defineExtensionPanel,
  type JsonValue,
  type PanelContext,
} from '../src/index.ts';

describe('defineExtensionPanel', () => {
  it('возвращает тот же объект модуля, mount получает контекст как есть', async () => {
    const mount = vi.fn();
    const module = { mount };
    const defined = defineExtensionPanel(module);
    expect(defined).toBe(module);

    const listeners: ((props: JsonValue | undefined) => void)[] = [];
    const context: PanelContext = {
      panelId: 'p',
      props: { a: 1 },
      signal: { aborted: false, addEventListener: () => undefined },
      call: async () => 'ok',
      onProps: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
    };
    const container = {} as HTMLElement;
    await defined.mount(container, context);
    expect(mount).toHaveBeenCalledWith(container, context);
  });
});
