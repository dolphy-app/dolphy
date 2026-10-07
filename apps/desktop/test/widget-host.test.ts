// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, inject, nextTick, reactive } from 'vue';
import type { App, Component } from 'vue';
import { createI18n } from 'vue-i18n';
import { WIDGET_HANDLE_KEY } from '@dolphy-app/extension-api';
import type { WidgetHandle } from '@dolphy-app/extension-api';
import type { WidgetContributionDto } from '@dolphy-app/engine-contract';
import { EXTENSION_COMMANDS_KEY } from '@/features/extension-commands';
import WidgetHost from '@/widgets/extension-widgets/ui/WidgetHost.vue';
import { en } from '@/widgets/extension-widgets/i18n/en.ts';

const WIDGET: WidgetContributionDto = {
  id: 'acme.cards.a',
  extensionId: 'acme.cards',
  title: 'a',
  slot: 'dailyPlan',
  when: null,
  rendererUrl: 'dolphy-ext://acme.cards/widget.mjs',
  origin: 'user',
  revision: 'r1',
};

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await nextTick();
};

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
});

const mountHost = async (
  components: Record<string, unknown>,
  state = reactive({ courseId: null as string | null }),
) => {
  const run = vi.fn(async () => 'pong' as const);
  const loadModule = vi.fn(async () => ({ default: components }));
  const app = createApp({
    render: () =>
      h(WidgetHost, {
        widget: WIDGET,
        commands: new Set(['acme.cards.ping']),
        context: state,
        loadModule,
      }),
  });
  const alert = defineComponent({
    render() {
      return h('div', this.$attrs, [this.$slots['default']?.()]);
    },
  });
  app
    .component('VAlert', alert)
    .component('VBtn', defineComponent({ render: () => h('button') }))
    .provide(EXTENSION_COMMANDS_KEY, { runner: { run } } as never)
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }));
  apps.push(app);
  const root = document.createElement('div');
  document.body.append(root);
  app.mount(root);
  await flush();
  return { root, state, run, loadModule };
};

describe('WidgetHost', () => {
  it('рисует компонент из default[widget.id] и даёт ему хендл', async () => {
    let handle: WidgetHandle | undefined;
    const Card = defineComponent({
      setup() {
        handle = inject(WIDGET_HANDLE_KEY);
        return () =>
          h('p', { 'data-testid': 'card' }, handle?.context.courseId ?? 'all');
      },
    });
    const { root, state, run, loadModule } = await mountHost({
      [WIDGET.id]: Card,
    });
    expect(loadModule).toHaveBeenCalledWith(
      'dolphy-ext://acme.cards/widget.mjs?v=r1',
    );
    expect(root.querySelector('[data-testid="card"]')?.textContent).toBe('all');
    expect(handle?.widgetId).toBe(WIDGET.id);

    state.courseId = 'c1';
    await flush();
    expect(root.querySelector('[data-testid="card"]')?.textContent).toBe('c1');

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

  it('ошибка рендера даёт карточку ошибки, остальное окно живо', async () => {
    const failRender = (): never => {
      throw new Error('render broke');
    };
    const Broken: Component = defineComponent({
      render() {
        return failRender();
      },
    });
    const { root } = await mountHost({ [WIDGET.id]: Broken });
    const failed = root.querySelector(
      '[data-testid="extension-widget-failed"]',
    );
    expect(failed?.textContent).toContain('render broke');
    expect(
      root.querySelector('[data-testid="extension-widget-body"]'),
    ).not.toBeNull();
  });

  it('неизвестный id — ошибка', async () => {
    const { root } = await mountHost({ other: defineComponent({}) });
    expect(
      root.querySelector('[data-testid="extension-widget-failed"]')
        ?.textContent,
    ).toContain(`widget module has no component ${WIDGET.id}`);
  });
});
