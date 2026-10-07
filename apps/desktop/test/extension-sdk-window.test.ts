// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import type { App } from 'vue';
import { z } from 'zod';
import { ENGINE_KEY } from '@dolphy-app/extension-api';
import type { AppApi } from '@dolphy-app/extension-api';
import { defineRpc } from '@dolphy-app/extension-sdk/rpc';
import { useApp, useEngine, useRpc } from '@dolphy-app/extension-sdk/client';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import { createExtensionApp } from '@/shared/lib/extension-app.ts';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import { sharedMessages } from '@/shared/i18n';
import { createI18n } from 'vue-i18n';
import { fakeEngine } from './support/app-fakes.ts';

const greet = defineRpc({
  name: 'acme.greet',
  input: z.object({ who: z.string() }),
  output: z.object({ text: z.string() }),
});

interface Seen {
  app: AppApi;
  engine: unknown;
  greet: (input: { who: string }) => Promise<{ text: string }>;
}

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
});

/** Окно с `useApp`/`useEngine`/`useRpc` из SDK внутри компонента, смонтированного через `mountAt`. */
const mountSdkComponent = (
  invokeRpc: (request: unknown) => Promise<unknown>,
) => {
  const root = document.createElement('div');
  document.body.append(root);
  const engine = fakeEngine({ extensions: { invokeRpc } });
  const notify = vi.fn();
  const app = createApp({ render: () => h('div') });
  app.provide(ENGINE_KEY, engine).use(
    createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: sharedMessages.en },
    }),
  );
  const extensionApps = createExtensionApp({
    app,
    router: { push: vi.fn(async () => undefined) },
    registry: createCommandRegistry(),
    focusCourse: vi.fn(async () => undefined),
    openPanel: vi.fn(),
    notify,
    theme: () => ({ id: 'light', dark: false }),
    locale: () => 'en',
    root,
  });
  app.provide(EXTENSION_APPS_KEY, extensionApps);
  apps.push(app);
  app.mount(document.createElement('div'));
  root.innerHTML = '<aside id="nav"></aside>';
  const seen: Partial<Seen> = {};
  const Component = defineComponent({
    setup() {
      seen.app = useApp();
      seen.engine = useEngine();
      seen.greet = useRpc(greet);
      return () => h('i');
    },
  });
  extensionApps.of('acme.a').mountAt('#nav', Component);
  return { seen, engine, notify, api: extensionApps.of('acme.a') };
};

describe('SDK внутри компонента расширения в окне', () => {
  it('useApp и useEngine дают объекты окна этого расширения', () => {
    const { seen, engine, api, notify } = mountSdkComponent(async () => null);
    expect(seen.app).toBe(api);
    expect(seen.engine).toBe(engine);
    seen.app?.notify('hi', 'success');
    expect(notify).toHaveBeenCalledWith('hi', 'success');
  });

  it('useRpc вызывает extensions.invokeRpc от имени расширения и проверяет ответ', async () => {
    const invokeRpc = vi.fn(async () => ({ text: 'Hello, Ann' }));
    const { seen } = mountSdkComponent(invokeRpc);
    await expect(seen.greet?.({ who: 'Ann' })).resolves.toEqual({
      text: 'Hello, Ann',
    });
    expect(invokeRpc).toHaveBeenCalledWith({
      extensionId: 'acme.a',
      name: 'acme.greet',
      input: { who: 'Ann' },
    });
  });

  it('неверный вход не доходит до движка, неверный ответ отклоняется, ошибка сервера доходит с текстом', async () => {
    const invokeRpc = vi
      .fn<(request: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({ text: 1 })
      .mockRejectedValueOnce(new Error('handler failed: no ann'));
    const { seen } = mountSdkComponent(invokeRpc);
    await expect(seen.greet?.({ who: 7 as never })).rejects.toThrow();
    expect(invokeRpc).not.toHaveBeenCalled();
    await expect(seen.greet?.({ who: 'Ann' })).rejects.toThrow();
    await expect(seen.greet?.({ who: 'Bob' })).rejects.toThrow(
      'handler failed: no ann',
    );
  });
});
