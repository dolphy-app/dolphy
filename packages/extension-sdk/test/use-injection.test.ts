import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import type { Component } from 'vue';
import { INJECTION_HANDLE_KEY, type InjectionHandle } from '../src/index.ts';
import { useInjection } from '../src/client.ts';

const mountWith = (component: Component, handle?: InjectionHandle) => {
  const host = document.createElement('div');
  const app = createApp(component);
  app.config.warnHandler = () => undefined;
  if (handle !== undefined) app.provide(INJECTION_HANDLE_KEY, handle);
  app.mount(host);
  return { host, app };
};

describe('useInjection', () => {
  it('returns the handle the app provides', () => {
    const target = document.createElement('section');
    const handle: InjectionHandle = { target, position: 'before' };
    let seen: InjectionHandle | undefined;
    const { host, app } = mountWith(
      defineComponent({
        setup() {
          seen = useInjection();
          return () => h('p', `${seen?.target.tagName}:${seen?.position}`);
        },
      }),
      handle,
    );
    expect(seen).toBe(handle);
    expect(host.textContent).toBe('SECTION:before');
    app.unmount();
  });

  it('throws a clear error outside an injected component', () => {
    expect(() =>
      mountWith(
        defineComponent({
          setup() {
            useInjection();
            return () => null;
          },
        }),
      ),
    ).toThrow(/injected component/);
  });
});
