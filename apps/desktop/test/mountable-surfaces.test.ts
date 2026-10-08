// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  shallowReactive,
  shallowRef,
} from 'vue';
import type { App } from 'vue';
import { createI18n } from 'vue-i18n';
import type { ExerciseTaskDto } from '@dolphy-app/engine-contract';
import { ENGINE_KEY } from '@dolphy-app/extension-api';
import type { JsonValue } from '@dolphy-app/extension-api';
import { EXTENSION_COMMANDS_KEY } from '@/features/extension-commands';
import PanelHost from '@/pages/extension-panel/ui/PanelHost.vue';
import { en as panelEn } from '@/pages/extension-panel/i18n/en.ts';
import { EXTENSION_CLIENTS_KEY } from '@/shared/lib/extension-clients.ts';
import type { ClientState } from '@/shared/lib/extension-clients.ts';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import { mountShell, unmountShell } from '@/shared/lib/extension-injections.ts';
import MarkdownView from '@/shared/ui/MarkdownView.vue';
import AnswerView from '@/widgets/exercise-panel/ui/AnswerView.vue';
import { fakeApps } from './support/app-fakes.ts';
import { fakeMountable } from './support/mountable-fakes.ts';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await nextTick();
};

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
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const windowApp = (render: () => ReturnType<typeof h>) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const app = createApp({ render });
  app
    .component('VAlert', stub('alert'))
    .component(
      'VBtn',
      defineComponent({
        render() {
          return h('button', this.$attrs);
        },
      }),
    )
    .provide(EXTENSION_APPS_KEY, fakeApps().apps)
    .provide(ENGINE_KEY, { extensions: {} })
    .use(
      createI18n({
        legacy: false,
        locale: 'en',
        messages: {
          en: {
            ...panelEn,
            extensionInjection: { failed: 'Injection {extensionId} failed' },
            common: { retry: 'Retry' },
            markdown: { renderFailed: 'Failed {language}' },
            exercisePanel: {
              answer: { loadFailed: 'Load {type} failed', retry: 'Retry' },
            },
          },
        },
      }),
    );
  apps.push(app);
  const root = document.createElement('div');
  document.body.append(root);
  return { app, root };
};

describe('Mountable в панели', () => {
  it('рисуется в div, props и курс доходят через onProps, сбой даёт «Повторить» и новый div', async () => {
    const state = shallowReactive({
      courseId: null as string | null,
      props: undefined as JsonValue | undefined,
    });
    let failing = true;
    const fake = fakeMountable((el, ctx) => {
      if (failing) throw new Error('boom');
      el.textContent = JSON.stringify(ctx.props);
      return () => undefined;
    });
    const { app, root } = windowApp(() =>
      h(PanelHost, {
        panel: {
          kind: 'panel',
          key: 'acme.cards:1:1',
          extensionId: 'acme.cards',
          id: 'acme.cards.main',
          title: 'Cards',
          icon: 'puzzle',
          when: null,
          header: true,
          component: fake.mountable,
        },
        commands: new Set<string>(),
        openProps: state.props,
        context: { courseId: state.courseId },
      }),
    );
    app.provide(EXTENSION_COMMANDS_KEY, { runner: { run: vi.fn() } } as never);
    app.mount(root);
    await flush();
    expect(root.querySelector('[data-testid="panel-load-failed"]')).not.toBe(
      null,
    );
    expect(root.textContent).toContain('boom');

    failing = false;
    root.querySelector<HTMLElement>('[data-testid="panel-retry"]')?.click();
    await flush();
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.el).not.toBe(fake.calls[0]?.el);
    const [, second] = fake.calls;
    expect(root.querySelector('[data-testid="panel-load-failed"]')).toBeNull();
    expect(second?.ctx.handle).toMatchObject({ panelId: 'acme.cards.main' });

    const seen = vi.fn();
    second?.ctx.onProps(seen);
    state.props = { card: 7 };
    state.courseId = 'c1';
    await flush();
    expect(seen).toHaveBeenLastCalledWith({
      panelId: 'acme.cards.main',
      props: { card: 7 },
      context: { courseId: 'c1' },
    });
  });
});

describe('Mountable во вставке', () => {
  it('рисуется в хосте вставки с target и position, очистка при снятии', async () => {
    const fake = fakeMountable();
    const { app } = windowApp(() => h('div'));
    app.mount(document.createElement('div'));
    const target = document.createElement('p');
    document.body.append(target);
    const host = mountShell(
      app,
      document,
      {
        extensionId: 'acme.cards',
        injectionId: 'acme.cards.badge',
        component: fake.mountable,
        handle: { target, position: 'after' },
      },
      (placed) => target.after(placed),
    );
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(host.textContent).toBe('{"target":{},"position":"after"}');
    expect(fake.calls[0]?.ctx.handle).toEqual({ target, position: 'after' });
    unmountShell(host);
    await flush();
    expect(fake.cleanup).toHaveBeenCalledOnce();
  });
});

describe('Mountable в виде ответа', () => {
  const TASK: ExerciseTaskDto = {
    type: 'acme.quiz',
    timeoutMs: 1000,
    extensionId: 'acme.quiz',
  };

  it('получает модель ответа, отдаёт change и submit', async () => {
    const fake = fakeMountable();
    const events: unknown[] = [];
    const value = shallowRef<unknown>(undefined);
    const registered = shallowRef([
      {
        kind: 'answerView' as const,
        key: 'acme.quiz:1:1',
        extensionId: 'acme.quiz',
        type: TASK.type,
        component: fake.mountable,
      },
    ]);
    const { app, root } = windowApp(() =>
      h(AnswerView, {
        task: TASK,
        view: { q: 1 },
        value: value.value,
        disabled: false,
        verdict: null,
        label: 'Answer',
        onChange: (detail: unknown) => events.push(['change', detail]),
        onSubmit: () => events.push(['submit']),
      }),
    );
    app.provide(EXTENSION_CLIENTS_KEY, {
      answerViews: registered,
      states: shallowRef(new Map<string, ClientState>()),
      reload: vi.fn(),
    } as never);
    app.mount(root);
    await flush();
    const ctx = fake.calls[0]?.ctx;
    expect(ctx?.props).toEqual({
      view: { q: 1 },
      value: undefined,
      disabled: false,
      verdict: null,
      label: 'Answer',
    });
    ctx?.emit('change', { value: 'b', complete: true });
    ctx?.emit('submit');
    expect(events).toEqual([
      ['change', { value: 'b', complete: true }],
      ['submit'],
    ]);
    const seen = vi.fn();
    ctx?.onProps(seen);
    value.value = 'b';
    await flush();
    expect(seen).toHaveBeenCalledOnce();
    expect(ctx?.props).toMatchObject({ value: 'b' });
  });
});

describe('Mountable в рендерере markdown', () => {
  it('рисуется на месте блока с source и language; сбой оставляет исходник', async () => {
    const fake = fakeMountable((el, ctx) => {
      el.textContent = JSON.stringify(ctx.props);
      return () => undefined;
    });
    const registered = shallowRef([
      {
        kind: 'markdownRenderer' as const,
        key: 'dolphy.math:1:1',
        extensionId: 'dolphy.math',
        language: 'math',
        component: fake.mountable,
      },
    ]);
    const { app, root } = windowApp(() =>
      h(MarkdownView, { source: '```math\nx^2\n```' }),
    );
    app.provide(EXTENSION_CLIENTS_KEY, {
      markdownRenderers: registered,
    } as never);
    app.mount(root);
    await flush();
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.textContent).toBe('{"source":"x^2\\n","language":"math"}');
    expect(block?.getAttribute('data-state')).toBe('done');
    fake.calls[0]?.ctx.reportError(new Error('bad'));
    await flush();
    expect(block?.getAttribute('data-state')).toBe('error');
    expect(block?.textContent).toContain('x^2');
    expect(block?.textContent).toContain('Failed math');
  });
});
