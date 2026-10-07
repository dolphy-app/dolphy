// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive } from 'vue';
import type { App, Component } from 'vue';
import { createI18n } from 'vue-i18n';
import type { ExerciseTaskDto } from '@dolphy-app/engine-contract';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { CONTRIBUTIONS_KEY } from '@/shared/api/engine/keys.ts';
import AnswerView from '@/widgets/exercise-panel/ui/AnswerView.vue';
import { en } from '@/widgets/exercise-panel/i18n/en.ts';

const TASK: ExerciseTaskDto = {
  type: 'acme.quiz',
  timeoutMs: 1000,
  rendererUrl: 'dolphy-ext://acme.quiz/view.mjs',
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

const Quiz = defineComponent({
  props: ['view', 'value', 'disabled', 'verdict', 'label'],
  emits: ['change', 'submit'],
  render() {
    return h('div', { 'data-testid': 'quiz' }, [
      h(
        'span',
        { 'data-testid': 'props' },
        JSON.stringify([
          this.view,
          this.value,
          this.disabled,
          this.verdict,
          this.label,
        ]),
      ),
      h('button', {
        'data-testid': 'pick',
        onClick: () => this.$emit('change', { value: 'b', complete: true }),
      }),
      h('button', {
        'data-testid': 'send',
        onClick: () => this.$emit('submit'),
      }),
    ]);
  },
});

const mountView = async (
  views: Record<string, Component>,
  state = reactive({ task: TASK, value: undefined as unknown }),
  contributions = NO_CONTRIBUTIONS,
) => {
  const events: unknown[] = [];
  const loadModule = vi.fn(async () => ({ default: { views } }));
  const app = createApp({
    render: () =>
      h(AnswerView, {
        task: state.task,
        view: { q: 1 },
        value: state.value,
        disabled: false,
        verdict: null,
        label: 'Answer',
        loadModule,
        onChange: (detail: unknown) => events.push(['change', detail]),
        onSubmit: () => events.push(['submit']),
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
          return h('button', this.$attrs, this.$slots['default']?.());
        },
      }),
    )
    .provide(CONTRIBUTIONS_KEY, { value: contributions } as never)
    .use(
      createI18n({
        legacy: false,
        locale: 'en',
        messages: { en: { exercisePanel: en.exercisePanel } },
      }),
    );
  apps.push(app);
  const root = document.createElement('div');
  document.body.append(root);
  app.mount(root);
  await flush();
  return { root, events, state, loadModule };
};

const click = async (root: HTMLElement, id: string) => {
  root
    .querySelector<HTMLElement>(`[data-testid="${id}"]`)
    ?.dispatchEvent(new Event('click'));
  await flush();
};

describe('AnswerView', () => {
  it('рисует default.views[type] с props и пересылает change и submit', async () => {
    const { root, events, loadModule } = await mountView({
      [TASK.type]: Quiz,
    });
    expect(loadModule).toHaveBeenCalledWith(
      'dolphy-ext://acme.quiz/view.mjs?v=r1',
    );
    expect(root.querySelector('[data-testid="props"]')?.textContent).toBe(
      JSON.stringify([{ q: 1 }, null, false, null, 'Answer']),
    );
    await click(root, 'pick');
    await click(root, 'send');
    expect(events).toEqual([
      ['change', { value: 'b', complete: true }],
      ['submit'],
    ]);
  });

  it('текущий ответ доходит до компонента без его пересоздания', async () => {
    const { root, state } = await mountView({ [TASK.type]: Quiz });
    const before = root.querySelector('[data-testid="quiz"]');
    state.value = 'b';
    await flush();
    expect(root.querySelector('[data-testid="quiz"]')).toBe(before);
    expect(root.querySelector('[data-testid="props"]')?.textContent).toContain(
      '"b"',
    );
  });

  it('ошибка рендера — v-alert с «Повторить»; повтор перерисовывает', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    const Flaky = defineComponent({
      render() {
        if (broken) throw new Error('render broke');
        return h('p', { 'data-testid': 'quiz' }, 'ok');
      },
    });
    const { root } = await mountView({ [TASK.type]: Flaky });
    expect(
      root.querySelector('[data-testid="answer-view-failed"]')?.textContent,
    ).toContain('render broke');
    broken = false;
    await click(root, 'answer-view-retry');
    expect(root.querySelector('[data-testid="quiz"]')?.textContent).toBe('ok');
    expect(root.querySelector('[data-testid="answer-view-failed"]')).toBeNull();
  });

  it('в модуле нет вида типа — ошибка загрузки с названием типа', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { root } = await mountView({ other: Quiz });
    const failed = root.querySelector('[data-testid="answer-view-failed"]');
    expect(failed?.textContent).toContain('acme.quiz');
    expect(failed?.textContent).toContain("no views component 'acme.quiz'");
  });

  it('новая ревизия задания пересоздаёт компонент и грузит модуль заново', async () => {
    const { root, state, loadModule } = await mountView({
      [TASK.type]: Quiz,
    });
    const before = root.querySelector('[data-testid="quiz"]');
    state.task = { ...TASK, revision: 'r2' };
    await flush();
    expect(loadModule).toHaveBeenLastCalledWith(
      'dolphy-ext://acme.quiz/view.mjs?v=r2',
    );
    expect(root.querySelector('[data-testid="quiz"]')).not.toBe(before);
  });

  it('происхождение dev: ревизия берётся из действующих вкладов', async () => {
    const dev: ExerciseTaskDto = { ...TASK, origin: 'dev' };
    const { loadModule } = await mountView(
      { [TASK.type]: Quiz },
      reactive({ task: dev, value: undefined }),
      {
        ...NO_CONTRIBUTIONS,
        exerciseTypes: [
          {
            type: TASK.type,
            rendererUrl: TASK.rendererUrl,
            revision: 'r9',
          } as never,
        ],
      },
    );
    expect(loadModule).toHaveBeenCalledWith(
      'dolphy-ext://acme.quiz/view.mjs?v=r9',
    );
  });
});
