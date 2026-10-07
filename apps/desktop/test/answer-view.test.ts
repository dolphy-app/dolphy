// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import type { App } from 'vue';
import { createI18n } from 'vue-i18n';
import type { ExerciseTaskDto } from '@dolphy-app/engine-contract';
import { EXTENSION_CLIENTS_KEY } from '@/shared/lib/extension-clients.ts';
import type {
  ClientAnswerView,
  ClientState,
} from '@/shared/lib/extension-clients.ts';
import AnswerView from '@/widgets/exercise-panel/ui/AnswerView.vue';
import { answerViewOf } from '@/widgets/exercise-panel/model/answer-view.ts';
import { en } from '@/widgets/exercise-panel/i18n/en.ts';

const TASK: ExerciseTaskDto = {
  type: 'acme.quiz',
  timeoutMs: 1000,
  extensionId: 'acme.quiz',
};

const viewOf = (
  component: unknown,
  extensionId = 'acme.quiz',
  instance = 1,
): ClientAnswerView => ({
  kind: 'answerView',
  key: `${extensionId}:${instance}:1`,
  extensionId,
  type: TASK.type,
  component: component as ClientAnswerView['component'],
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

const mountView = async (views: ClientAnswerView[]) => {
  const events: unknown[] = [];
  const state = shallowRef({ value: undefined as unknown });
  const registered = shallowRef(views);
  const states = shallowRef(new Map<string, ClientState>());
  const reload = vi.fn();
  const app = createApp({
    render: () =>
      h(AnswerView, {
        task: TASK,
        view: { q: 1 },
        value: state.value.value,
        disabled: false,
        verdict: null,
        label: 'Answer',
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
    .provide(EXTENSION_CLIENTS_KEY, {
      answerViews: registered,
      states,
      reload,
    } as never)
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
  return { root, events, state, registered, states, reload };
};

const click = async (root: HTMLElement, id: string) => {
  root
    .querySelector<HTMLElement>(`[data-testid="${id}"]`)
    ?.dispatchEvent(new Event('click'));
  await flush();
};

describe('answerViewOf', () => {
  it('вид владельца вида важнее; иначе первый в порядке реестра; вида нет — null', () => {
    const owner = viewOf('a', 'acme.quiz');
    const alien = viewOf('b', 'acme.aaa');
    expect(answerViewOf([alien, owner], TASK.type, 'acme.quiz')).toBe(owner);
    expect(answerViewOf([alien], TASK.type, 'acme.quiz')).toBe(alien);
    expect(answerViewOf([owner], 'other.type', 'acme.quiz')).toBeNull();
  });
});

describe('AnswerView', () => {
  it('рисует зарегистрированный вид с props и пересылает change и submit', async () => {
    const { root, events } = await mountView([viewOf(Quiz)]);
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
    const { root, state } = await mountView([viewOf(Quiz)]);
    const before = root.querySelector('[data-testid="quiz"]');
    state.value = { value: 'b' };
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
    const { root } = await mountView([viewOf(Flaky)]);
    expect(
      root.querySelector('[data-testid="answer-view-failed"]')?.textContent,
    ).toContain('render broke');
    broken = false;
    await click(root, 'answer-view-retry');
    expect(root.querySelector('[data-testid="quiz"]')?.textContent).toBe('ok');
    expect(root.querySelector('[data-testid="answer-view-failed"]')).toBeNull();
  });

  it('вида нет в реестре — ошибка с названием типа; «Повторить» просит реестр загрузить расширение заново', async () => {
    const { root, reload } = await mountView([]);
    const failed = root.querySelector('[data-testid="answer-view-failed"]');
    expect(failed?.textContent).toContain('acme.quiz');
    expect(failed?.textContent).toContain(
      "no answer view registered for 'acme.quiz'",
    );
    await click(root, 'answer-view-retry');
    expect(reload).toHaveBeenCalledExactlyOnceWith('acme.quiz');
  });

  it('клиентская часть владельца ещё грузится — ни ошибки, ни ввода; когда вид появился, он рисуется', async () => {
    const { root, registered, states } = await mountView([]);
    states.value = new Map([['acme.quiz', { status: 'loading', error: null }]]);
    await flush();
    expect(root.querySelector('[data-testid="answer-view-failed"]')).toBeNull();
    registered.value = [viewOf(Quiz)];
    await flush();
    expect(root.querySelector('[data-testid="quiz"]')).not.toBeNull();
  });

  it('клиентская часть не загрузилась — причина показана', async () => {
    const { root, states } = await mountView([]);
    states.value = new Map([
      ['acme.quiz', { status: 'failed', error: 'import broke' }],
    ]);
    await flush();
    expect(
      root.querySelector('[data-testid="answer-view-failed"]')?.textContent,
    ).toContain('import broke');
  });

  it('новый экземпляр вида (правка расширения) пересоздаёт компонент', async () => {
    const { root, registered } = await mountView([viewOf(Quiz)]);
    const before = root.querySelector('[data-testid="quiz"]');
    registered.value = [viewOf(Quiz, 'acme.quiz', 2)];
    await flush();
    const after = root.querySelector('[data-testid="quiz"]');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('расширение удалено посреди упражнения — остаётся последний вид, ввод не пропадает', async () => {
    const { root, registered } = await mountView([viewOf(Quiz)]);
    registered.value = [];
    await flush();
    expect(root.querySelector('[data-testid="quiz"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="answer-view-failed"]')).toBeNull();
  });
});
