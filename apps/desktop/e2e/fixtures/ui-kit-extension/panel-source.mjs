// Панель для e2e на @dolphy-app/extension-ui: каждый элемент набора в обычном и особом состоянии.
// Собирается в panel.mjs перед запуском (см. ui-kit.e2e.test.ts): панель получает набор в бандле.
import {
  button,
  card,
  emptyState,
  list,
  select,
  textField,
  toggle,
} from '@dolphy-app/extension-ui';

export default {
  mount(container) {
    const status = document.createElement('p');
    status.setAttribute('data-role', 'status');
    status.setAttribute('role', 'status');
    status.textContent = 'Ничего не выбрано';
    const say = (message) => {
      status.textContent = message;
    };

    container.append(
      card({
        title: 'Профиль',
        children: [
          textField({
            label: 'Имя',
            value: 'Ада',
            description: 'Как к вам обращаться',
            onInput: (value) => say(`Имя: ${value}`),
          }),
          textField({
            label: 'Возраст',
            type: 'number',
            value: '-1',
            error: 'Возраст не может быть отрицательным',
          }),
          select({
            label: 'Уровень',
            options: [
              { value: 'easy', label: 'Лёгкий' },
              { value: 'hard', label: 'Сложный' },
            ],
            value: 'easy',
            onChange: (value) => say(`Уровень: ${value}`),
          }),
          toggle({
            label: 'Присылать напоминания',
            onChange: (checked) => say(checked ? 'Включено' : 'Выключено'),
          }),
          toggle({ label: 'Недоступный переключатель', disabled: true }),
        ],
      }),
      card({
        title: 'Курсы',
        children: [
          list({
            label: 'Список курсов',
            emptyText: 'Курсов нет',
            selected: 'sql',
            items: [
              { id: 'sql', label: 'SQL', description: 'Запросы и схемы' },
              { id: 'js', label: 'JavaScript', description: 'Основы языка' },
              { id: 'old', label: 'Архив', disabled: true },
            ],
            onSelect: (id) => say(`Выбран: ${id}`),
          }),
          button({
            label: 'Основное',
            variant: 'primary',
            onClick: () => say('Основное'),
          }),
          ' ',
          button({ label: 'Обычное', onClick: () => say('Обычное') }),
          ' ',
          button({
            label: 'Удалить',
            variant: 'danger',
            onClick: () => say('Удалить'),
          }),
          ' ',
          button({ label: 'Недоступное', disabled: true }),
        ],
      }),
      emptyState({
        title: 'Пока пусто',
        description: 'Добавьте первый курс',
        action: button({
          label: 'Добавить курс',
          variant: 'primary',
          onClick: () => say('Добавить'),
        }),
      }),
      status,
    );
  },
};
