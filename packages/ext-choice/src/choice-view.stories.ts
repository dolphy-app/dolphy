import type { AnswerChange } from '@dolphy-app/extension-api';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { h } from 'vue';
import { ChoiceAnswerView } from './choice-view.ts';

interface ChoiceArgs {
  /** `view.options`: подписи вариантов. */
  options: string[];
  /** `view.multiple`: чекбоксы вместо радиокнопок. */
  multiple: boolean;
  /** Свойство `value`: индексы отмеченных вариантов (восстановление ответа). */
  value: number[];
  /** Свойство `disabled`: блокирует варианты, выбор сохраняется. */
  disabled: boolean;
  /** Свойство `label`: имя группы для скринридера. */
  label: string;
  /** Событие `change`. */
  onChange: (change: AnswerChange<number[]>) => void;
}

const OPTIONS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

const meta = {
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Вид ввода ответа `dolphy.choice`: компонент с радиокнопками или ' +
          'чекбоксами Vuetify. Тему даёт переключатель Theme на панели ' +
          '(встроенные темы приложения).',
      },
    },
  },
  argTypes: {
    options: { control: 'object' },
    multiple: { control: 'boolean' },
    value: { control: 'object' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
    onChange: { control: false },
  },
  args: {
    options: OPTIONS,
    multiple: false,
    value: [],
    disabled: false,
    label: 'Choose the correct answer',
    onChange: fn(),
  },
  render: (args: ChoiceArgs) => ({
    render: () =>
      h(ChoiceAnswerView, {
        view: { multiple: args.multiple, options: args.options },
        value: args.value,
        disabled: args.disabled,
        label: args.label,
        onChange: args.onChange,
      }),
  }),
} satisfies Meta<ChoiceArgs>;

export default meta;
type Story = StoryObj<ChoiceArgs>;

const inputsOf = (canvasElement: HTMLElement, type: 'radio' | 'checkbox') =>
  waitFor(() => {
    const inputs = [
      ...canvasElement.querySelectorAll<HTMLInputElement>(
        `input[type=${type}]`,
      ),
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
    await expect(args.onChange).toHaveBeenLastCalledWith({
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
    await expect(args.onChange).toHaveBeenLastCalledWith({
      value: [0, 3],
      complete: true,
    });
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[3]!);
    await expect(args.onChange).toHaveBeenLastCalledWith({
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
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};
