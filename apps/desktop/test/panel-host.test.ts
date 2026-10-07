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
import type { PanelContributionDto } from '@dolphy-app/engine-contract';
import { EXTENSION_COMMANDS_KEY } from '@/features/extension-commands';
import PanelHost from '@/pages/extension-panel/ui/PanelHost.vue';
import { en } from '@/pages/extension-panel/i18n/en.ts';

const PANEL: PanelContributionDto = {
  id: 'acme.cards.main',
  extensionId: 'acme.cards',
  title: 'Cards',
  icon: 'puzzle',
  when: null,
  rendererUrl: 'dolphy-ext://acme.cards/panel.mjs',
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
  vi.restoreAllMocks();
});

const mountHost = async (
  components: Record<string, unknown>,
  state = shallowReactive({
    courseId: null as string | null,
    props: undefined as JsonValue | undefined,
  }),
) => {
  const run = vi.fn(async () => 'pong' as const);
  const loadModule = vi.fn(async () => ({ default: { panels: components } }));
  const app = createApp({
    render: () =>
      h(PanelHost, {
        panel: PANEL,
        commands: new Set(['acme.cards.ping']),
        openProps: state.props,
        context: { courseId: state.courseId },
        loadModule,
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
    .provide(EXTENSION_COMMANDS_KEY, { runner: { run } } as never)
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }));
  apps.push(app);
  const root = document.createElement('div');
  document.body.append(root);
  app.mount(root);
  await flush();
  return { root, state, run, loadModule };
};

describe('PanelHost', () => {
  it('рисует default.panels[id] и даёт хендл: props и context реактивны, call проверяет команду', async () => {
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
    const { root, state, run, loadModule } = await mountHost({
      [PANEL.id]: Page,
    });
    expect(loadModule).toHaveBeenCalledWith(
      'dolphy-ext://acme.cards/panel.mjs?v=r1',
    );
    expect(handle?.panelId).toBe(PANEL.id);
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

  it('ошибка рендера — v-alert с «Повторить», страница живёт', async () => {
    let broken = true;
    const Page = defineComponent({
      render() {
        if (broken) throw new Error('render broke');
        return h('p', { 'data-testid': 'page' }, 'ok');
      },
    });
    const { root } = await mountHost({ [PANEL.id]: Page });
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

  it('неизвестный id — ошибка загрузки', async () => {
    const { root } = await mountHost({ other: defineComponent({}) });
    expect(
      root.querySelector('[data-testid="panel-load-failed"]')?.textContent,
    ).toContain(`no panels component '${PANEL.id}'`);
  });
});
