// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApp,
  defineComponent,
  h,
  inject,
  nextTick,
  shallowReactive,
} from 'vue';
import type { App } from 'vue';
import { createI18n } from 'vue-i18n';
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-api';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-api';
import { EXTENSION_COMMANDS_KEY } from '@/features/extension-commands';
import PanelHost from '@/pages/extension-panel/ui/PanelHost.vue';
import { en } from '@/pages/extension-panel/i18n/en.ts';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import { contextProbe, fakeApps } from './support/app-fakes.ts';
import type { ContextSeen } from './support/app-fakes.ts';
import type { ClientPanel } from '@/shared/lib/extension-clients.ts';

const panelOf = (component: unknown): ClientPanel => ({
  kind: 'panel',
  key: 'acme.cards:1:1',
  extensionId: 'acme.cards',
  id: 'acme.cards.main',
  title: 'Cards',
  icon: 'puzzle',
  when: null,
  component: component as ClientPanel['component'],
});

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await nextTick();
};

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const mountHost = async (
  component: unknown,
  state = shallowReactive({
    courseId: null as string | null,
    props: undefined as JsonValue | undefined,
  }),
) => {
  const run = vi.fn(async () => 'pong' as const);
  const app = createApp({
    render: () =>
      h(PanelHost, {
        panel: panelOf(component),
        commands: new Set(['acme.cards.ping']),
        openProps: state.props,
        context: { courseId: state.courseId },
      }),
  });
  app
    .component(
      'VAlert',
      defineComponent({
        render() {
          return h('div', this.$attrs, [
            this.$slots['default']?.(),
            this.$slots['append']?.(),
          ]);
        },
      }),
    )
    .component(
      'VBtn',
      defineComponent({
        render() {
          return h('button', this.$attrs);
        },
      }),
    )
    .provide(EXTENSION_APPS_KEY, fakeApps().apps)
    .provide(EXTENSION_COMMANDS_KEY, { runner: { run } } as never)
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }));
  apps.push(app);
  const root = document.createElement('div');
  document.body.append(root);
  app.mount(root);
  await flush();
  return { root, state, run };
};

describe('PanelHost', () => {
  it('рисует зарегистрированный компонент и даёт хендл: props и context реактивны, call проверяет команду', async () => {
    let handle: PanelHandle | undefined;
    const Page = defineComponent({
      setup() {
        handle = inject(PANEL_HANDLE_KEY);
        return () =>
          h(
            'p',
            { 'data-testid': 'page' },
            JSON.stringify([handle?.props, handle?.context.courseId]),
          );
      },
    });
    const { root, state, run } = await mountHost(Page);
    expect(handle?.panelId).toBe('acme.cards.main');
    const text = () => root.querySelector('[data-testid="page"]')?.textContent;
    expect(text()).toBe('[null,null]');

    // повторный openPanel и смена курса доходят без пересоздания
    state.props = { card: 7 };
    state.courseId = 'c1';
    await flush();
    expect(text()).toBe('[{"card":7},"c1"]');

    await expect(handle?.call('acme.cards.ping', { n: 1 })).resolves.toBe(
      'pong',
    );
    expect(run).toHaveBeenCalledExactlyOnceWith(
      'acme.cards',
      'acme.cards.ping',
      { n: 1 },
      'panel',
    );
    await expect(handle?.call('evil.other.steal')).rejects.toThrow(
      'unknown command',
    );
    expect(run).toHaveBeenCalledOnce();
  });
  it('даёт компоненту id расширения и его AppApi', async () => {
    const seen: ContextSeen = {};
    await mountHost(contextProbe(seen));
    expect(seen.id).toBe('acme.cards');
    expect(seen.app).toMatchObject({ locale: 'en' });
  });

  it('ошибка рендера — v-alert с «Повторить», страница живёт, повтор создаёт компонент заново', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    const Page = defineComponent({
      render() {
        if (broken) throw new Error('render broke');
        return h('p', { 'data-testid': 'page' }, 'ok');
      },
    });
    const { root } = await mountHost(Page);
    expect(
      root.querySelector('[data-testid="panel-load-failed"]')?.textContent,
    ).toContain('render broke');
    broken = false;
    root
      .querySelector('[data-testid="panel-retry"]')
      ?.dispatchEvent(new Event('click'));
    await flush();
    expect(root.querySelector('[data-testid="page"]')?.textContent).toBe('ok');
  });
});
