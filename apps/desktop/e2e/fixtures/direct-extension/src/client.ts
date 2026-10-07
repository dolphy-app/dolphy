// Клиентская часть: панель с кнопками `useRpc`, `useApp`, `useEngine` и компонент,
// который `useApp().mountAt` монтирует в боковое меню.
import { defineComponent, h, ref } from 'vue';
import { VBtn } from 'vuetify/components';
import { defineClient } from '@dolphy-app/extension-sdk';
import { useApp, useEngine, useRpc } from '@dolphy-app/extension-sdk/client';
import {
  coursesRpc,
  countRpc,
  failRpc,
  greetRpc,
  recordRpc,
} from './shared/rpc.ts';

const EXTENSION_ID = 'acme.direct';
const COURSE_ID = 'direct_kb';
const LESSON_ID = 'direct_kb::basic';
const EXERCISE_ID = 'direct_kb::basic::q1';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const MenuMark = defineComponent({
  props: { label: { type: String, required: true } },
  setup(props) {
    const app = useApp();
    const greet = useRpc(greetRpc);
    const text = ref('');
    void greet({ name: 'меню' }).then((reply) => {
      text.value = reply.text;
    });
    return () =>
      h('div', { 'data-testid': 'direct-mounted' }, [
        h('p', { 'data-role': 'label' }, props.label),
        h('p', { 'data-role': 'locale' }, `Язык: ${app.locale}`),
        h('p', { 'data-role': 'reply' }, text.value),
      ]);
  },
});

const Panel = defineComponent({
  setup() {
    const app = useApp();
    const engine = useEngine();
    const greet = useRpc(greetRpc);
    const fail = useRpc(failRpc);
    const count = useRpc(countRpc);
    const courses = useRpc(coursesRpc);
    const record = useRpc(recordRpc);
    const result = ref('');
    const attempt = async (run: () => Promise<unknown>) => {
      try {
        result.value = `ok ${JSON.stringify((await run()) ?? null)}`;
      } catch (error) {
        result.value = `Ошибка: ${message(error)}`;
      }
    };
    const button = (title: string, run: () => Promise<unknown>) =>
      h(VBtn, { onClick: () => void attempt(run) }, () => title);
    return () =>
      h('div', { 'data-testid': 'direct-panel' }, [
        h('p', { 'data-role': 'result' }, result.value),
        button('Поздороваться', () => greet({ name: 'Ада' })),
        // useRpc проверяет вход до обращения к серверу
        button('Пустое имя', () => greet({ name: '' })),
        // мимо useRpc: сервер проверяет вход сам
        button('Пустое имя мимо клиента', () =>
          engine.extensions.invokeRpc({
            extensionId: EXTENSION_ID,
            name: greetRpc.name,
            input: { name: '' },
          }),
        ),
        button('Сломать', () => fail({})),
        button('Сколько приветствий', () => count({})),
        button('Прочитать курсы', async () => {
          const page = await engine.library.listCourses();
          return page.items.map(({ name }) => name);
        }),
        button('Прочитать курсы на сервере', () => courses({})),
        button('Записать на сервере', () =>
          record({ exerciseId: EXERCISE_ID, grade: 4 }),
        ),
        button('Записать из компонента', async () => {
          const reply = await engine.practice.recordAttempt({
            requestId: `acme.direct.window.${Date.now()}`,
            exerciseId: EXERCISE_ID,
            grade: 5,
          });
          return { eventId: reply.eventId };
        }),
        button('Перейти к уроку', async () =>
          app.openLesson(COURSE_ID, LESSON_ID),
        ),
        button('Уведомить', async () => app.notify('Привет из расширения')),
        button('Смонтировать в меню', async () => {
          app.mountAt('[data-testid="extension-nav"]', MenuMark, {
            label: 'Смонтировано',
          });
        }),
      ]);
  },
});

export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.direct.main',
    title: { en: 'Direct', ru: 'Прямой доступ' },
    component: Panel,
  });
});
