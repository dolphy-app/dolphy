import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn } from 'storybook/test';
import TourStepCard from './TourStepCard.vue';

const meta = {
  component: TourStepCard,
  tags: ['autodocs'],
  args: {
    title: 'Один курс или все сразу',
    text: 'Выберите курс, и план, повторения и занятие возьмут задания только из него. «Все курсы» возвращает общий план. Прогресс каждого курса хранится отдельно.',
    step: 3,
    total: 7,
    isFirst: false,
    isLast: false,
    onBack: fn(),
    onNext: fn(),
    onSkip: fn(),
  },
} satisfies Meta<typeof TourStepCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** На первом шаге «Назад» нет. */
export const FirstStep: Story = {
  args: { step: 1, isFirst: true, title: 'Как это работает' },
};

/** На последнем шаге вместо «Далее» — «Готово». */
export const LastStep: Story = {
  args: { step: 7, isLast: true, title: 'Настройки' },
};

export const LongText: Story = {
  args: {
    text: 'Курсы берутся из Git-репозитория: вставьте адрес, и они появятся в каталоге. «Граф знаний» на карточке показывает, как уроки связаны между собой, а «Проверить, что я знаю» определяет, что вы уже знаете. '.repeat(
      2,
    ),
  },
};

export const UnbrokenWord: Story = {
  args: { title: 'ЭлектромагнитноСовместимыйИнтерфейсПрограммирования' },
};

export const EmitsActions: Story = {
  globals: { locale: 'ru' },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Далее' }));
    await expect(args.onNext).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Назад' }));
    await expect(args.onBack).toHaveBeenCalledOnce();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Пропустить тур' }),
    );
    await expect(args.onSkip).toHaveBeenCalledOnce();
  },
};

/** Tab ходит по кнопкам карточки по кругу и не уходит со страницы. */
export const TrapsFocus: Story = {
  globals: { locale: 'ru' },
  play: async ({ canvas, userEvent }) => {
    const skip = canvas.getByRole('button', { name: 'Пропустить тур' });
    const next = canvas.getByRole('button', { name: 'Далее' });
    skip.focus();
    await userEvent.tab();
    await userEvent.tab();
    await expect(next).toHaveFocus();
    await userEvent.tab();
    await expect(skip).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(next).toHaveFocus();
  },
};
