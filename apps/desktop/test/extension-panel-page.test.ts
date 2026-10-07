// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import type { App } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { COURSE_SCOPE_KEY } from '@/features/course-scope';
import { EXTENSION_COMMANDS_KEY } from '@/features/extension-commands';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { CONTRIBUTIONS_KEY } from '@/shared/api/engine/keys.ts';
import { EXTENSION_CLIENTS_KEY } from '@/shared/lib/extension-clients.ts';
import type {
  ClientPanel,
  ClientState,
} from '@/shared/lib/extension-clients.ts';
import ExtensionPanelPage from '@/pages/extension-panel/ui/ExtensionPanelPage.vue';
import { en } from '@/pages/extension-panel/i18n/en.ts';
import { textComponent } from './support/client-fakes.ts';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import { fakeApps } from './support/app-fakes.ts';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await nextTick();
};

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
});

const PANEL: ClientPanel = {
  kind: 'panel',
  key: 'acme.cards:1:1',
  extensionId: 'acme.cards',
  id: 'acme.cards.main',
  title: { en: 'Cards', ru: 'Карточки' },
  icon: 'puzzle',
  when: null,
  component: textComponent('panel-content', 'content'),
};

const button = defineComponent({
  render() {
    return h('button', this.$attrs, this.$slots['default']?.());
  },
});
const emptyState = defineComponent({
  props: ['text'],
  render() {
    return h('div', this.$attrs, [this.text, this.$slots['actions']?.()]);
  },
});

const mountPage = async (
  panels: ClientPanel[],
  states: [string, ClientState][] = [],
) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/ext/:extensionId/:panelId',
        name: 'extension-panel',
        component: { render: () => null },
      },
    ],
  });
  await router.push('/ext/acme.cards/acme.cards.main');
  const registered = shallowRef(panels);
  const stateMap = shallowRef(new Map(states));
  const reload = vi.fn();
  const app = createApp({ render: () => h(ExtensionPanelPage) });
  app
    .component('VBtn', button)
    .component('VEmptyState', emptyState)
    .component('VProgressCircular', defineComponent({ render: () => h('i') }))
    .provide(EXTENSION_APPS_KEY, fakeApps().apps)
    .provide(CONTRIBUTIONS_KEY, shallowRef(NO_CONTRIBUTIONS))
    .provide(COURSE_SCOPE_KEY, { activeId: ref(null) } as never)
    .provide(EXTENSION_COMMANDS_KEY, {
      panelProps: { get: () => undefined, clear: () => {} },
      runner: { run: vi.fn() },
    } as never)
    .provide(EXTENSION_CLIENTS_KEY, {
      panels: registered,
      states: stateMap,
      reload,
    } as never)
    .use(router)
    .use(
      createI18n({
        legacy: false,
        locale: 'ru',
        fallbackLocale: 'en',
        messages: { en: { extensionPanel: en.extensionPanel } },
      }),
    );
  apps.push(app);
  const root = document.createElement('div');
  document.body.append(root);
  app.mount(root);
  await flush();
  return { root, registered, stateMap, reload };
};

const heading = (root: HTMLElement) =>
  root.querySelector('h1')?.textContent?.trim();
const has = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-testid="${id}"]`) !== null;

describe('ExtensionPanelPage', () => {
  it('зарегистрированная панель рисуется под заголовком на языке окна', async () => {
    const { root } = await mountPage([PANEL]);
    expect(heading(root)).toBe('Карточки');
    expect(has(root, 'panel-content')).toBe(true);
  });

  it('клиентская часть ещё грузится — индикатор вместо «панель недоступна»; потом панель', async () => {
    const { root, registered, stateMap } = await mountPage(
      [],
      [['acme.cards', { status: 'loading', error: null }]],
    );
    expect(has(root, 'panel-loading')).toBe(true);
    expect(has(root, 'panel-unavailable')).toBe(false);
    registered.value = [PANEL];
    stateMap.value = new Map([
      ['acme.cards', { status: 'loaded', error: null }],
    ]);
    await flush();
    expect(has(root, 'panel-content')).toBe(true);
    expect(has(root, 'panel-loading')).toBe(false);
  });

  it('клиентская часть не загрузилась — причина и «Повторить» просит реестр загрузить заново', async () => {
    const { root, reload } = await mountPage(
      [],
      [['acme.cards', { status: 'failed', error: 'import broke' }]],
    );
    expect(
      root.querySelector('[data-testid="panel-client-failed"]')?.textContent,
    ).toContain('import broke');
    root
      .querySelector('[data-testid="panel-client-retry"]')
      ?.dispatchEvent(new Event('click'));
    expect(reload).toHaveBeenCalledExactlyOnceWith('acme.cards');
  });

  it('расширение отключено или удалено — «панель недоступна»', async () => {
    const { root } = await mountPage([]);
    expect(has(root, 'panel-unavailable')).toBe(true);
    expect(heading(root)).toBe('Panel unavailable');
  });
});
