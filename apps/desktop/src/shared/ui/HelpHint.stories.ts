import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, screen, waitFor } from 'storybook/test';
import HelpHint from './HelpHint.vue';

const meta = {
  component: HelpHint,
  tags: ['autodocs'],
  args: {
    text: 'Запоминаемость — оценка вероятности, что вы вспомните упражнение. Когда она падает ниже этого порога, упражнение попадает в план как повторение.',
  },
  // подсказка раскрывается вверх: ей нужно место над значком
  render: (args) => ({
    components: { HelpHint },
    setup: () => ({ args }),
    template:
      '<div style="padding-top: 8rem"><span class="text-title-medium font-weight-bold">Целевая запоминаемость</span> <HelpHint v-bind="args" /></div>',
  }),
} satisfies Meta<typeof HelpHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongText: Story = {
  args: { text: 'Очень длинное пояснение. '.repeat(20) },
};

/** Подсказка открывается наведением и фокусом с клавиатуры. */
export const OpensOnHover: Story = {
  globals: { locale: 'ru' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole('button', { name: 'Что это?' }));
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Запоминаемость'),
    );
  },
};

export const OpensOnFocus: Story = {
  globals: { locale: 'ru' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(
      canvas.getByRole('button', { name: 'Что это?' }),
    ).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Запоминаемость'),
    );
  },
};
