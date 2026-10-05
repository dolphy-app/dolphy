import { ANSWER_EVENT } from '@dolphy-app/extension-api';
import type { AnswerChangeDetail } from '@dolphy-app/extension-api';
import { registerAnswerView } from '@dolphy-app/extension-sdk/runtime';
import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { views } from './index.ts';

const TAG = 'dolphy-choice-answer';

registerAnswerView(TAG, views['dolphy.choice']);

interface ChoiceArgs {
  /** `view.options`: подписи вариантов. */
  options: string[];
  /** `view.multiple`: чекбоксы вместо радиокнопок. */
  multiple: boolean;
  /** Свойство `value`: индексы отмеченных вариантов (восстановление ответа). */
  value: number[];
  /** Свойство `disabled`: блокирует варианты, выбор сохраняется. */
  disabled: boolean;
  /** `aria-label` элемента, который выставляет приложение. */
  label: string;
  /** Событие `dolphy-answer-change`. */
  onAnswerChange: (detail: AnswerChangeDetail) => void;
}

const OPTIONS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

const mountElement = (args: ChoiceArgs) => {
  const element = document.createElement(TAG);
  element.setAttribute('aria-label', args.label);
  element.addEventListener(ANSWER_EVENT.change, (event) =>
    args.onAnswerChange((event as CustomEvent<AnswerChangeDetail>).detail),
  );
  Object.assign(element, {
    view: { multiple: args.multiple, options: args.options },
    value: args.value,
    disabled: args.disabled,
  });
  return element;
};

const meta = {
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Вид ввода ответа `dolphy.choice`: элемент `dolphy-choice-answer` ' +
          'с радиокнопками или чекбоксами в теневом корне. Тему даёт ' +
          'переключатель Theme на панели (переменные `--v-theme-*` ' +
          'встроенных тем приложения).',
      },
    },
  },
  argTypes: {
    options: { control: 'object' },
    multiple: { control: 'boolean' },
    value: { control: 'object' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
    onAnswerChange: { control: false },
  },
  args: {
    options: OPTIONS,
    multiple: false,
    value: [],
    disabled: false,
    label: 'Choose the correct answer',
    onAnswerChange: fn(),
  },
  render: mountElement,
} satisfies Meta<ChoiceArgs>;

export default meta;
type Story = StoryObj<ChoiceArgs>;

/** Поля ввода в теневом корне: запросы `canvas` теневой DOM не видят. */
const inputsOf = (canvasElement: HTMLElement, type: 'radio' | 'checkbox') =>
  waitFor(() => {
    const inputs = [
      ...(canvasElement
        .querySelector(TAG)
        ?.shadowRoot?.querySelectorAll<HTMLInputElement>(
          `input[type=${type}]`,
        ) ?? []),
    ];
    if (inputs.length === 0) throw new Error(`no ${type} inputs rendered`);
    return inputs;
  });

export const Single: Story = {};

export const Multiple: Story = { args: { multiple: true } };

export const SinglePreselected: Story = { args: { value: [1] } };

export const MultiplePreselected: Story = {
  args: { multiple: true, value: [0, 2] },
};

export const Disabled: Story = {
  args: { multiple: true, value: [1, 3], disabled: true },
};

export const LongOptions: Story = {
  args: {
    options: [
      'Оператор DELETE без условия WHERE удаляет все строки таблицы, ' +
        'но не саму таблицу и не её индексы',
      'Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious',
      'Короткий',
    ],
  },
};

export const ManyOptions: Story = {
  args: {
    options: Array.from({ length: 12 }, (_, index) => `Вариант ${index + 1}`),
    multiple: true,
  },
};

export const Empty: Story = { args: { options: [] } };

export const SelectsOne: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const radios = await inputsOf(canvasElement, 'radio');
    await userEvent.click(radios[2]!);
    await userEvent.click(radios[1]!);
    await expect(args.onAnswerChange).toHaveBeenLastCalledWith({
      value: [1],
      complete: true,
    });
    await expect(radios[2]).not.toBeChecked();
  },
};

export const SelectsManyInOrder: Story = {
  args: { multiple: true },
  play: async ({ args, canvasElement, userEvent }) => {
    const boxes = await inputsOf(canvasElement, 'checkbox');
    await userEvent.click(boxes[3]!);
    await userEvent.click(boxes[0]!);
    await expect(args.onAnswerChange).toHaveBeenLastCalledWith({
      value: [0, 3],
      complete: true,
    });
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[3]!);
    await expect(args.onAnswerChange).toHaveBeenLastCalledWith({
      value: [],
      complete: false,
    });
  },
};

export const DisabledIgnoresClicks: Story = {
  args: { disabled: true, value: [1] },
  play: async ({ args, canvasElement, userEvent }) => {
    const radios = await inputsOf(canvasElement, 'radio');
    await userEvent.click(radios[0]!);
    await expect(radios[1]).toBeChecked();
    await expect(args.onAnswerChange).not.toHaveBeenCalled();
  },
};
