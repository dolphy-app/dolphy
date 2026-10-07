// Расширение для e2e протокола `overlay`: вид ответа и рендерер markdown с меню и диалогом
// внизу короткого содержимого. Собирается `dolphy-ext build` (см. ui-kit-overlay.e2e.test.ts).
import {
  defineAnswerView,
  defineExtension,
  defineExerciseType,
  defineMarkdownRenderer,
} from '@dolphy-app/extension-sdk';
import {
  mountDialog,
  mountMenu,
} from '@dolphy-app/extension-ui/vuetify/navigation';

const OVERLAY_EVENT = 'dolphy-overlay';

const button = (
  doc: Document,
  role: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement => {
  const node = doc.createElement('button');
  node.type = 'button';
  node.dataset.role = role;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
};

/**
 * Короткое содержимое (одна строка и кнопки), меню из шести пунктов и диалог под ним: рамка
 * по содержимому ниже и меню, и диалога. Кнопки «Занять экран» и «Освободить» шлют событие
 * протокола как чужое расширение: запрос заведомо больше окна.
 */
const mountDemo = (container: Element): (() => void) => {
  const doc = container.ownerDocument;
  const box = doc.createElement('div');
  box.dataset.role = 'overlay-demo';
  const line = doc.createElement('p');
  line.textContent = 'Короткое содержимое';
  line.style.margin = '4px 0';
  const menuSlot = doc.createElement('div');
  const tools = doc.createElement('div');
  const dialogSlot = doc.createElement('div');
  box.append(line, menuSlot, tools, dialogSlot);
  container.append(box);

  const menu = mountMenu(menuSlot, {
    label: 'Действия',
    items: ['Первое', 'Второе', 'Третье', 'Четвёртое', 'Пятое', 'Шестое'].map(
      (label, value) => ({ value, label }),
    ),
    onSelect: () => {},
  });
  const dialog = mountDialog(dialogSlot, {
    open: false,
    title: 'Подтверждение',
    content:
      'Текст диалога из нескольких слов, чтобы он занимал заметную высоту.',
    actions: [
      { label: 'Отмена', value: 'cancel' },
      { label: 'Готово', value: 'done', color: 'primary' },
    ],
    onClose: () => dialog.update({ open: false }),
  });
  const request = (height: number | null): void => {
    box.dispatchEvent(
      new CustomEvent(OVERLAY_EVENT, {
        detail: { height },
        bubbles: true,
        composed: true,
      }),
    );
  };
  tools.append(
    button(doc, 'open-dialog', 'Открыть диалог', () =>
      dialog.update({ open: true }),
    ),
    button(doc, 'take-screen', 'Занять экран', () => request(100_000)),
    button(doc, 'release-screen', 'Освободить', () => request(null)),
  );
  return () => {
    menu.destroy();
    dialog.destroy();
    box.remove();
  };
};

export const host = defineExtension({
  exerciseTypes: {
    'acme.overlay': defineExerciseType({
      project: () => ({}),
      grade: () => ({ outcome: 'passed' }),
    }),
  },
});

export const views = {
  'acme.overlay': defineAnswerView((api) => {
    const destroy = mountDemo(api.root);
    return { update() {}, destroy };
  }),
};

export const markdown = {
  overlay: defineMarkdownRenderer((_source, container) => {
    mountDemo(container);
  }),
};
