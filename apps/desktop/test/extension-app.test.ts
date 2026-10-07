// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computed,
  createApp,
  defineComponent,
  h,
  inject,
  nextTick,
  ref,
} from 'vue';
import type { App } from 'vue';
import { createI18n } from 'vue-i18n';
import { APP_KEY, EXTENSION_ID_KEY } from '@dolphy-app/extension-api';
import type { AppApi, AppTheme } from '@dolphy-app/extension-api';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import { createExtensionApp } from '@/shared/lib/extension-app.ts';
import type { ExtensionAppDeps } from '@/shared/lib/extension-app.ts';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import { sharedMessages } from '@/shared/i18n';

const stub = (name: string) =>
  defineComponent({
    inheritAttrs: false,
    render() {
      return h('div', { ...this.$attrs, 'data-stub': name }, [
        this.$slots['default']?.(),
        this.$slots['append']?.(),
      ]);
    },
  });

const apps: App[] = [];
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await nextTick();
};

const setup = (patch: Partial<ExtensionAppDeps> = {}) => {
  const root = document.createElement('div');
  root.innerHTML = '<aside id="nav"><b>own</b></aside>';
  document.body.append(root);
  const registry = createCommandRegistry();
  const theme = ref<AppTheme>({ id: 'light', dark: false });
  const locale = ref<'en' | 'ru'>('en');
  const deps = {
    router: { push: vi.fn(async () => undefined) },
    registry,
    focusCourse: vi.fn(async () => undefined),
    openPanel: vi.fn(),
    notify: vi.fn(),
    theme: () => theme.value,
    locale: () => locale.value,
    root,
  };
  const app = createApp({ render: () => h('div') });
  app
    .component('VAlert', stub('alert'))
    .component('VBtn', stub('btn'))
    .use(
      createI18n({
        legacy: false,
        locale: 'en',
        messages: { en: sharedMessages.en },
      }),
    );
  apps.push(app);
  app.mount(document.createElement('div'));
  const all = { app, ...deps, ...patch };
  const extensionApps = createExtensionApp(all);
  app.provide(EXTENSION_APPS_KEY, extensionApps);
  return {
    ...all,
    registry,
    extensionApps,
    api: extensionApps.of('acme.a'),
    root,
    theme,
    locale,
  };
};

describe('AppApi окна: навигация', () => {
  it('openCourse ставит курс в фокус, затем открывает «Курсы»', async () => {
    const order: string[] = [];
    const { api, router } = setup({
      focusCourse: vi.fn(async () => void order.push('focus')),
      router: {
        push: vi.fn(async () => void order.push('push')),
      },
    });
    api.openCourse('course-1');
    await flush();
    expect(order).toEqual(['focus', 'push']);
    expect(router.push).toHaveBeenCalledWith({ name: ROUTE.courses });
  });

  it.each([
    ['openLesson', (api: AppApi) => api.openLesson('c1', 'l1')],
    ['openExercise', (api: AppApi) => api.openExercise('c1', 'l1', 'e1')],
  ])('%s открывает сессию курса', async (_name, open) => {
    const { api, router } = setup();
    open(api);
    await flush();
    expect(router.push).toHaveBeenCalledWith({
      name: ROUTE.session,
      query: { course: 'c1' },
    });
  });

  it('openSettings: без id — «Расширения», с id — страница расширения', async () => {
    const { api, router } = setup();
    api.openSettings();
    api.openSettings('acme.b');
    await flush();
    expect(router.push).toHaveBeenNthCalledWith(1, {
      name: ROUTE.settingsExtensions,
    });
    expect(router.push).toHaveBeenNthCalledWith(2, {
      name: ROUTE.settingsExtensionDetails,
      params: { id: 'acme.b' },
    });
  });

  it('сбой перехода уходит в журнал, а не в необработанное отклонение', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('navigation failed');
    const { api } = setup({
      router: {
        push: vi.fn(async () => {
          throw failure;
        }),
      },
    });
    api.openSettings();
    await flush();
    expect(error).toHaveBeenCalledWith(
      { error: failure, extensionId: 'acme.a' },
      'app.openSettings failed',
    );
  });

  it('openPanel отдаёт свойства окну как JSON и отвергает не-JSON до перехода', () => {
    const { api, openPanel } = setup();
    api.openPanel('acme.b', 'acme.b.main', { page: 2 });
    api.openPanel('acme.b', 'acme.b.main');
    expect(openPanel).toHaveBeenNthCalledWith(1, 'acme.b', 'acme.b.main', {
      page: 2,
    });
    expect(openPanel).toHaveBeenNthCalledWith(
      2,
      'acme.b',
      'acme.b.main',
      undefined,
    );
    expect(() => api.openPanel('acme.b', 'acme.b.main', () => 1)).toThrow();
    expect(openPanel).toHaveBeenCalledTimes(2);
  });
});

describe('AppApi окна: уведомления, тема, язык', () => {
  it('notify: вид по умолчанию info', () => {
    const { api, notify } = setup();
    api.notify('Saved');
    api.notify('Oops', 'error');
    expect(notify).toHaveBeenNthCalledWith(1, 'Saved', 'info');
    expect(notify).toHaveBeenNthCalledWith(2, 'Oops', 'error');
  });

  it('theme и locale читаются при каждом обращении и отслеживаются computed', () => {
    const { api, theme, locale } = setup();
    const summary = computed(
      () => `${api.theme.id}:${String(api.theme.dark)}:${api.locale}`,
    );
    expect(summary.value).toBe('light:false:en');
    theme.value = { id: 'dark', dark: true };
    locale.value = 'ru';
    expect(summary.value).toBe('dark:true:ru');
  });

  it('один объект на расширение', () => {
    const { extensionApps } = setup();
    expect(extensionApps.of('acme.a')).toBe(extensionApps.of('acme.a'));
    expect(extensionApps.of('acme.a')).not.toBe(extensionApps.of('acme.b'));
  });
});

describe('AppApi окна: runCommand', () => {
  const register = (
    registry: CommandRegistry,
    key: string,
    run: () => void | Promise<void>,
    enabled = true,
  ) =>
    registry.register({ key, source: 'extension', title: key, enabled, run });

  it('вызывает команду реестра и ждёт её завершения', async () => {
    const { api, registry } = setup();
    const done: string[] = [];
    register(registry, 'extension:acme.b:go', async () => {
      await nextTick();
      done.push('ran');
    });
    await api.runCommand('extension:acme.b:go');
    expect(done).toEqual(['ran']);
  });

  it('нет команды, команда недоступна или упала — отклонённый промис', async () => {
    const { api, registry } = setup();
    register(registry, 'app:off', () => {}, false);
    register(registry, 'app:boom', () => {
      throw new Error('boom');
    });
    await expect(api.runCommand('app:missing')).rejects.toThrow(
      "unknown command 'app:missing'",
    );
    await expect(api.runCommand('app:off')).rejects.toThrow(
      "command 'app:off' is disabled",
    );
    await expect(api.runCommand('app:boom')).rejects.toThrow('boom');
  });
});

const probe = (seen: { id?: unknown; app?: unknown }) =>
  defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      seen.id = inject(EXTENSION_ID_KEY, null);
      seen.app = inject(APP_KEY, null);
      return () => h('i', { class: 'mounted' }, props.label);
    },
  });

describe('AppApi окна: mountAt', () => {
  it('монтирует компонент в элемент по селектору, внутри него; своя разметка цела', () => {
    const { api, root } = setup();
    const seen: { id?: unknown; app?: unknown } = {};
    const handle = api.mountAt('#nav', probe(seen), { label: 'L' });
    disposers.push(() => handle.dispose());
    const mounted = root.querySelector(
      '#nav > [data-ext-injection] > .mounted',
    );
    expect(mounted?.textContent).toBe('L');
    expect(root.querySelector('#nav > b')?.textContent).toBe('own');
    expect(
      root
        .querySelector('[data-ext-injection]')
        ?.getAttribute('data-ext-injection'),
    ).toBe('acme.a/mountAt');
    expect(seen.id).toBe('acme.a');
    expect(seen.app).toBe(api);
  });

  it('принимает элемент; селектор разрешается в момент вызова', () => {
    const { api, root } = setup();
    const nav = root.querySelector('#nav');
    expect(nav).not.toBeNull();
    expect(() => api.mountAt('.late', probe({}))).toThrow(
      "mountAt: no element matches '.late'",
    );
    const late = document.createElement('section');
    late.className = 'late';
    root.append(late);
    const byClass = api.mountAt('.late', probe({}));
    const byElement = api.mountAt(late, probe({}));
    disposers.push(
      () => byClass.dispose(),
      () => byElement.dispose(),
    );
    expect(late.querySelectorAll('.mounted')).toHaveLength(2);
  });

  it('нет элемента или неверный селектор — понятная ошибка', () => {
    const { api } = setup();
    expect(() => api.mountAt('#absent', probe({}))).toThrow(
      "mountAt: no element matches '#absent'",
    );
    expect(() => api.mountAt('div[', probe({}))).toThrow(
      "mountAt: invalid target 'div['",
    );
    expect(() => api.mountAt('#nav', 42)).toThrow('must be a Vue component');
  });

  it('dispose размонтирует компонент и хост; повторный вызов безопасен', () => {
    const { api, root } = setup();
    const handle = api.mountAt('#nav', probe({}));
    expect(root.querySelector('.mounted')).not.toBeNull();
    handle.dispose();
    handle.dispose();
    expect(root.querySelector('[data-ext-injection]')).toBeNull();
    expect(root.querySelector('#nav')?.children).toHaveLength(1);
  });

  it('сбой компонента гасится оболочкой: карточка с повтором, исключения нет', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, root } = setup();
    const broken = defineComponent({
      setup: () => {
        throw new Error('render failed');
      },
    });
    const handle = api.mountAt('#nav', broken);
    disposers.push(() => handle.dispose());
    await flush();
    const card = root.querySelector(
      '[data-testid="extension-injection-failed"]',
    );
    expect(card?.textContent).toContain('acme.a');
    expect(card?.textContent).toContain('render failed');
    expect(
      root.querySelector('[data-testid="extension-injection-retry"]'),
    ).not.toBeNull();
  });
});
