// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, inject } from 'vue';
import type { App, Component } from 'vue';
import { createI18n } from 'vue-i18n';
import { INJECTION_HANDLE_KEY } from '@dolphy-app/extension-api';
import type {
  ClientContext,
  InjectionHandle,
  InjectionPosition,
} from '@dolphy-app/extension-api';
import { createInjectionMounter } from '@/shared/lib/extension-injections.ts';
import type { InjectionMounter } from '@/shared/lib/extension-injections.ts';
import { sharedMessages } from '@/shared/i18n';
import {
  clientDto,
  createTestClients,
  moduleOf,
} from './support/client-fakes.ts';
import { flush } from './support/extensions-fakes.ts';

const TARGET = '#target';

const label = (text: string): Component =>
  defineComponent({
    render: () => h('b', { class: 'injected' }, text),
  });

const apps: App[] = [];
const mounters: InjectionMounter[] = [];
afterEach(() => {
  for (const mounter of mounters.splice(0)) mounter.dispose();
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

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

/**
 * Окно с корнем `#app`, реестром на подставных модулях и движком вставок на
 * ручном планировщике: `frame()` выполняет отложенный проход и ждёт
 * наблюдателя.
 */
const setup = async (
  modules: Record<string, (c: ClientContext) => void>,
  extensionIds: string[],
  html = `<main><div id="target"><span>own</span></div></main>`,
) => {
  const root = document.createElement('div');
  root.id = 'app';
  root.innerHTML = html;
  document.body.append(root);
  const { registry } = createTestClients(
    Object.fromEntries(
      Object.entries(modules).map(([id, client]) => [
        `dolphy-ext://${id}/client.mjs`,
        moduleOf(client),
      ]),
    ),
    extensionIds.map((id) => clientDto(id)),
  );
  await flush();
  const app = createApp({ render: () => h('div') });
  app
    .provide('theme', 'indigo')
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
  const queue: (() => void)[] = [];
  const mounter = createInjectionMounter({
    app,
    root,
    clients: registry,
    schedule: (run) => queue.push(run),
  });
  mounters.push(mounter);
  const frame = async () => {
    await flush();
    for (const run of queue.splice(0)) run();
    await flush();
  };
  await frame();
  return { root, registry, mounter, frame, queue };
};

const injectedTexts = (root: ParentNode) =>
  [...root.querySelectorAll('.injected')].map((node) => node.textContent);

describe('вставки расширений в DOM окна', () => {
  it.each<[InjectionPosition, string]>([
    ['before', 'main > [data-ext-injection] + #target'],
    ['after', 'main > #target + [data-ext-injection]'],
    ['prepend', '#target > [data-ext-injection]:first-child'],
    ['append', '#target > [data-ext-injection]:last-child'],
  ])('позиция %s ставит хост относительно цели', async (position, shape) => {
    const { root } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: TARGET,
            position,
            component: label('A'),
          }),
      },
      ['acme.a'],
    );
    const host = root.querySelector('[data-ext-injection]');
    expect(host?.getAttribute('data-ext-injection')).toBe('acme.a/acme.a.i');
    expect(host?.getAttribute('data-testid')).toBe('extension-injection');
    expect((host as HTMLElement).style.display).toBe('contents');
    expect(root.querySelectorAll(shape)).toHaveLength(1);
    expect(injectedTexts(root)).toEqual(['A']);
  });

  it('позиция по умолчанию — append', async () => {
    const { root } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: TARGET,
            component: label('A'),
          }),
      },
      ['acme.a'],
    );
    expect(
      root.querySelector('#target > [data-ext-injection]:last-child'),
    ).not.toBeNull();
  });

  it('цель появилась позже — компонент смонтирован, цель исчезла — снят; своя разметка цела', async () => {
    const { root, frame } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: '.late',
            component: label('A'),
          }),
      },
      ['acme.a'],
    );
    expect(injectedTexts(root)).toEqual([]);

    const late = document.createElement('section');
    late.className = 'late';
    late.textContent = 'own';
    root.append(late);
    await frame();
    expect(injectedTexts(late)).toEqual(['A']);
    expect(late.firstChild?.textContent).toBe('own');

    late.remove();
    await frame();
    expect(root.querySelector('[data-ext-injection]')).toBeNull();
    expect(late.querySelector('[data-ext-injection]')).toBeNull();
  });

  it('несколько целей получают по компоненту; в обслуженную цель повторной вставки нет', async () => {
    const mounted = vi.fn();
    const Counter = defineComponent({
      setup() {
        mounted();
        return () => h('b', { class: 'injected' }, 'N');
      },
    });
    const { root, frame } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: '.card',
            component: Counter,
          }),
      },
      ['acme.a'],
      '<div class="card"></div><div class="card"></div>',
    );
    expect(mounted).toHaveBeenCalledTimes(2);
    const extra = document.createElement('p');
    root.append(extra);
    await frame();
    await frame();
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('[data-ext-injection]')).toHaveLength(2);
  });

  it('хост, потерянный из-за перерисовки родителя, ставится заново', async () => {
    const { root, frame } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: TARGET,
            component: label('A'),
          }),
      },
      ['acme.a'],
    );
    root.querySelector('[data-ext-injection]')?.remove();
    await frame();
    expect(injectedTexts(root)).toEqual(['A']);
    expect(root.querySelectorAll('[data-ext-injection]')).toHaveLength(1);
  });

  it('селектор, совпадающий с хостом и его содержимым, не вкладывает вставки друг в друга', async () => {
    const { root, frame } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: 'div',
            component: label('A'),
          }),
      },
      ['acme.a'],
      '<div id="one"></div>',
    );
    await frame();
    await frame();
    // `#one` и сам `#app`-корень вне поиска: внутри корня одна цель
    expect(root.querySelectorAll('[data-ext-injection]')).toHaveLength(1);
  });

  it('два расширения: порядок по id расширения, затем по регистрации', async () => {
    const { root } = await setup(
      {
        'acme.b': (c) =>
          void c.addInjection({
            id: 'acme.b.i',
            target: TARGET,
            component: label('B'),
          }),
        'acme.a': (c) => {
          c.addInjection({
            id: 'acme.a.one',
            target: TARGET,
            component: label('A1'),
          });
          c.addInjection({
            id: 'acme.a.two',
            target: TARGET,
            component: label('A2'),
          });
        },
      },
      ['acme.b', 'acme.a'],
    );
    expect(injectedTexts(root)).toEqual(['A1', 'A2', 'B']);
  });

  it('ошибка компонента гасится оболочкой, остальные вставки и разметка живы', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = defineComponent({
      setup: () => () => {
        throw new Error('render broke');
      },
    });
    const { root } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: TARGET,
            component: Broken,
          }),
        'acme.b': (c) =>
          void c.addInjection({
            id: 'acme.b.i',
            target: TARGET,
            component: label('B'),
          }),
      },
      ['acme.a', 'acme.b'],
    );
    const failed = root.querySelector(
      '[data-testid="extension-injection-failed"]',
    );
    expect(failed?.textContent).toContain('render broke');
    expect(failed?.textContent).toContain('acme.a');
    expect(injectedTexts(root)).toEqual(['B']);
    expect(root.querySelector('#target span')?.textContent).toBe('own');
  });

  it('неверный селектор: расширение failed и без вставок, остальные живы', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { root, registry, frame } = await setup(
      {
        'acme.a': (c) => {
          c.addInjection({
            id: 'acme.a.ok',
            target: TARGET,
            component: label('A'),
          });
          c.addInjection({
            id: 'acme.a.bad',
            target: '[[nope',
            component: label('bad'),
          });
        },
        'acme.b': (c) =>
          void c.addInjection({
            id: 'acme.b.i',
            target: TARGET,
            component: label('B'),
          }),
      },
      ['acme.a', 'acme.b'],
    );
    await frame();
    expect(registry.states.value.get('acme.a')).toMatchObject({
      status: 'failed',
    });
    expect(registry.states.value.get('acme.a')?.error).toContain(
      "invalid target '[[nope'",
    );
    expect(registry.states.value.get('acme.b')?.status).toBe('loaded');
    expect(injectedTexts(root)).toEqual(['B']);
  });

  it('вставка снимается вместе с расширением и при Disposable', async () => {
    let handle: { dispose(): void } | undefined;
    const { root, registry, frame } = await setup(
      {
        'acme.a': (c) => {
          handle = c.addInjection({
            id: 'acme.a.i',
            target: TARGET,
            component: label('A'),
          });
        },
        'acme.b': (c) =>
          void c.addInjection({
            id: 'acme.b.i',
            target: TARGET,
            component: label('B'),
          }),
      },
      ['acme.a', 'acme.b'],
    );
    expect(injectedTexts(root)).toEqual(['A', 'B']);
    handle?.dispose();
    await frame();
    expect(injectedTexts(root)).toEqual(['B']);
    registry.dispose();
    await frame();
    expect(root.querySelector('[data-ext-injection]')).toBeNull();
  });

  it('dispose чистит DOM и останавливает слежение', async () => {
    const { root, mounter, frame, queue } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: '.card',
            component: label('A'),
          }),
      },
      ['acme.a'],
      '<div class="card"></div>',
    );
    expect(injectedTexts(root)).toEqual(['A']);
    mounter.dispose();
    expect(root.querySelector('[data-ext-injection]')).toBeNull();
    const card = document.createElement('div');
    card.className = 'card';
    root.append(card);
    await frame();
    expect(queue).toEqual([]);
    expect(root.querySelectorAll('[data-ext-injection]')).toHaveLength(0);
  });

  it('компонент получает provide приложения и хендл с целью и позицией', async () => {
    let theme: unknown;
    let handle: InjectionHandle | undefined;
    const Probe = defineComponent({
      setup() {
        theme = inject('theme');
        handle = inject<InjectionHandle>(INJECTION_HANDLE_KEY);
        return () => h('b', { class: 'injected' }, 'P');
      },
    });
    const { root } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: TARGET,
            position: 'after',
            component: Probe,
          }),
      },
      ['acme.a'],
    );
    expect(theme).toBe('indigo');
    expect(handle?.target).toBe(root.querySelector(TARGET));
    expect(handle?.position).toBe('after');
  });

  it('свои вставки и изменения внутри хоста не запускают новый проход', async () => {
    const { root, frame, queue } = await setup(
      {
        'acme.a': (c) =>
          void c.addInjection({
            id: 'acme.a.i',
            target: TARGET,
            component: label('A'),
          }),
      },
      ['acme.a'],
    );
    // собственные вставки повода для нового прохода не дают
    await flush();
    expect(queue).toEqual([]);
    const host = root.querySelector('[data-ext-injection]') as HTMLElement;
    host.append(document.createElement('i'));
    await flush();
    expect(queue).toEqual([]);
    root.append(document.createElement('p'));
    await flush();
    expect(queue).toHaveLength(1);
    await frame();
  });
});
