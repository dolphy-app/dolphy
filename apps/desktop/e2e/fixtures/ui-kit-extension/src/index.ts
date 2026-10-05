// Панель для e2e на подпутях @dolphy-app/extension-ui/vuetify/*: по секции на группу компонентов.
// Собирается `dolphy-ext build` (см. ui-kit.e2e.test.ts): Vue и Vuetify попадают в panel.mjs, их CSS — через реестр.
import { defineExtensionPanel } from '@dolphy-app/extension-sdk';
import {
  mountCheckboxGroup,
  mountRadioGroup,
} from '@dolphy-app/extension-ui/vuetify/choice';
import {
  mountAlert,
  mountChip,
  mountProgress,
  mountSkeleton,
} from '@dolphy-app/extension-ui/vuetify/feedback';
import {
  mountDateField,
  mountSlider,
  mountSwitch,
  mountTextarea,
} from '@dolphy-app/extension-ui/vuetify/fields';
import {
  mountDialog,
  mountMenu,
  mountTabs,
  mountTooltip,
} from '@dolphy-app/extension-ui/vuetify/navigation';
import {
  mountDataTable,
  mountTable,
} from '@dolphy-app/extension-ui/vuetify/table';

const el = (
  doc: Document,
  tag: string,
  attributes: Record<string, string> = {},
  text = '',
): HTMLElement => {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  node.textContent = text;
  return node;
};

/** Секция группы: заголовок и отдельные узлы под каждый компонент. */
const section = (doc: Document, group: string, title: string) => {
  const root = el(doc, 'section', {
    'data-group': group,
    'aria-labelledby': `heading-${group}`,
  });
  root.append(el(doc, 'h2', { id: `heading-${group}` }, title));
  const slot = (name: string): HTMLElement => {
    const node = el(doc, 'div', { 'data-slot': name });
    node.style.margin = '8px 0';
    root.append(node);
    return node;
  };
  return { root, slot };
};

const COLUMNS = [
  { key: 'course', title: 'Курс' },
  { key: 'cards', title: 'Карточек', align: 'end' as const },
];
const ROWS = [
  { course: 'Алгебра', cards: 12 },
  { course: 'Биология', cards: 7 },
  { course: 'Химия', cards: 31 },
];

export const panels = {
  'acme.uikit.main': defineExtensionPanel({
    mount(container) {
      const doc = container.ownerDocument;
      const status = el(
        doc,
        'p',
        { 'data-role': 'status', role: 'status' },
        'Ничего не выбрано',
      );
      const say = (message: string): void => {
        status.textContent = message;
      };
      const page = el(doc, 'main', { 'data-role': 'kit' });
      page.style.padding = '16px';
      page.append(el(doc, 'h1', {}, 'Набор элементов'), status);

      const choice = section(doc, 'choice', 'Выбор');
      const level = mountRadioGroup(choice.slot('radio'), {
        label: 'Уровень',
        items: [
          { value: 'easy', label: 'Лёгкий' },
          { value: 'medium', label: 'Средний' },
          { value: 'hard', label: 'Сложный' },
        ],
        value: 'medium',
        onChange: (value) => {
          level.update({ value });
          say(`Уровень: ${value}`);
        },
      });
      const topics = mountCheckboxGroup(choice.slot('checkbox'), {
        label: 'Темы',
        items: [
          { value: 1, label: 'Дроби' },
          { value: 2, label: 'Степени' },
          { value: 3, label: 'Корни', disabled: true },
        ],
        value: [1],
        onChange: (value) => {
          topics.update({ value });
          say(`Темы: ${value.join(',')}`);
        },
      });

      const feedback = section(doc, 'feedback', 'Статусы');
      mountAlert(feedback.slot('alert'), {
        type: 'success',
        title: 'Сохранено',
        text: 'Изменения применены',
        closable: true,
      });
      mountAlert(feedback.slot('alert-error'), {
        type: 'error',
        title: 'Ошибка',
        text: 'Проверьте поля',
      });
      mountChip(feedback.slot('chip'), { label: 'Готово', color: 'primary' });
      mountProgress(feedback.slot('progress'), {
        value: 40,
        label: 'Загрузка курса',
      });
      mountProgress(feedback.slot('progress-ring'), {
        value: null,
        label: 'Подготовка',
        shape: 'circular',
      });
      mountSkeleton(feedback.slot('skeleton'), {
        type: 'paragraph',
        loading: true,
      });

      const fields = section(doc, 'fields', 'Поля');
      mountTextarea(fields.slot('textarea'), {
        label: 'Заметка',
        value: 'Черновик',
        onChange: (value) => say(`Заметка: ${value}`),
      });
      mountSlider(fields.slot('slider'), {
        label: 'Громкость',
        min: 0,
        max: 10,
        value: 5,
        onChange: (value) => say(`Громкость: ${value}`),
      });
      mountSwitch(fields.slot('switch'), {
        label: 'Присылать напоминания',
        value: false,
        onChange: (value) => say(value ? 'Включено' : 'Выключено'),
      });
      mountDateField(fields.slot('date'), {
        label: 'Дата экзамена',
        value: '2026-10-05',
        onChange: (value) => say(`Дата: ${value ?? 'пусто'}`),
      });

      const navigation = section(doc, 'navigation', 'Навигация');
      const tabs = [
        { value: 'overview', label: 'Обзор' },
        { value: 'tasks', label: 'Задания' },
        { value: 'results', label: 'Итоги' },
      ];
      const tabsView = mountTabs(navigation.slot('tabs'), {
        label: 'Разделы курса',
        items: tabs,
        value: 'overview',
        idPrefix: 'kit-tabs',
        onChange: (value) => {
          tabsView.update({ value });
          say(`Раздел: ${value}`);
        },
        onPanel: (value, element) => {
          const item = tabs.find((tab) => tab.value === value);
          if (element !== null && item !== undefined) {
            element.textContent = `Содержимое: ${item.label}`;
          }
        },
      });
      const dialog = mountDialog(navigation.slot('dialog'), {
        open: false,
        title: 'Сохранить изменения?',
        content: 'Изменения нельзя будет отменить',
        actions: [
          { label: 'Отмена', value: 'cancel' },
          { label: 'Сохранить', value: 'save', color: 'primary' },
        ],
        onClose: (value) => {
          dialog.update({ open: false });
          say(`Диалог: ${value ?? 'закрыт'}`);
        },
      });
      const opener = el(
        doc,
        'button',
        { type: 'button', 'data-role': 'open-dialog' },
        'Открыть диалог',
      );
      opener.addEventListener('click', () => dialog.update({ open: true }));
      navigation.slot('dialog-opener').append(opener);
      mountMenu(navigation.slot('menu'), {
        label: 'Действия',
        items: [
          { value: 'rename', label: 'Переименовать' },
          { value: 'archive', label: 'В архив' },
          { value: 'delete', label: 'Удалить', disabled: true },
        ],
        onSelect: (value) => say(`Действие: ${value}`),
      });
      mountTooltip(navigation.slot('tooltip'), {
        label: 'Подсказка',
        text: 'Текст подсказки',
      });

      const tables = section(doc, 'table', 'Таблицы');
      mountTable(tables.slot('table'), {
        caption: 'Курсы',
        columns: COLUMNS,
        rows: ROWS,
      });
      mountDataTable(tables.slot('data-table'), {
        caption: 'Курсы с сортировкой',
        columns: COLUMNS,
        rows: ROWS,
      });
      mountDataTable(tables.slot('data-table-empty'), {
        caption: 'Пустая таблица',
        columns: COLUMNS,
        rows: [],
      });

      page.append(
        choice.root,
        feedback.root,
        fields.root,
        navigation.root,
        tables.root,
      );
      container.append(page);
    },
  }),
};
