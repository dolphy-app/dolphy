import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';
import type { CourseSummary } from '@/entities/course';
import CourseCard from './CourseCard.vue';

const course = (overrides: Partial<CourseSummary> = {}): CourseSummary => ({
  id: 'git-basics',
  name: 'Основы Git',
  description:
    'Коммиты, ветки, слияния и удалённые репозитории: всё, что нужно для ежедневной работы с кодом.',
  lessonCount: 12,
  lessonsDone: 5,
  status: 'in-progress',
  attempts: 40,
  due: 0,
  ...overrides,
});

const meta = {
  component: CourseCard,
  tags: ['autodocs'],
  argTypes: {
    tone: { control: 'select', options: ['primary', 'secondary', 'info'] },
  },
  args: {
    course: course(),
    tone: 'primary',
    focused: false,
    recommended: false,
    updateAvailable: false,
    onStudy: fn(),
    onOpenPlan: fn(),
    onCheck: fn(),
    onGraph: fn(),
  },
  // карточка живёт в колонке сетки страницы: `minmax(min(100%, 20rem), 1fr)`
  render: (args) => ({
    components: { CourseCard },
    setup: () => ({ args }),
    template:
      '<div style="width: 22rem; max-width: 100%"><CourseCard v-bind="args" /></div>',
  }),
} satisfies Meta<typeof CourseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NotStarted: Story = {
  args: {
    course: course({ status: 'ready', attempts: 0, lessonsDone: 0 }),
  },
};

export const Completed: Story = {
  args: {
    course: course({ status: 'mastered', lessonsDone: 12, attempts: 180 }),
  },
};

export const WithDueReviews: Story = {
  args: { course: course({ due: 14 }) },
};

export const Locked: Story = {
  args: {
    course: course({ status: 'locked', attempts: 0, lessonsDone: 0 }),
  },
};

export const Hidden: Story = {
  args: { course: course({ status: 'blacklisted' }) },
};

export const Superseded: Story = {
  args: { course: course({ status: 'superseded' }) },
};

export const Focused: Story = {
  args: { focused: true, course: course({ due: 6 }) },
};

export const Recommended: Story = {
  args: { recommended: true },
};

export const UpdateAvailable: Story = {
  args: { updateAvailable: true },
};

export const FocusedWithUpdate: Story = {
  args: { focused: true, updateAvailable: true },
};

export const NoDescription: Story = {
  args: { course: course({ description: undefined }) },
};

export const NoLessons: Story = {
  args: {
    course: course({
      lessonCount: 0,
      lessonsDone: 0,
      attempts: 0,
      status: 'ready',
    }),
  },
};

export const LongContent: Story = {
  args: {
    recommended: true,
    updateAvailable: true,
    course: course({
      name: 'Продвинутые структуры данных и алгоритмы для подготовки к собеседованиям в крупные компании',
      description:
        'Деревья, графы, динамическое программирование, жадные алгоритмы и разбор типовых задач. '.repeat(
          3,
        ),
    }),
  },
};

/** Чип «В фокусе» не сжимается, как бы ни был длинен неразрывный заголовок. */
export const UnbrokenName: Story = {
  args: {
    focused: true,
    course: course({
      name: 'ЭлектромагнитноСовместимыйИнтерфейсПрограммирования-v2.0.1-release-candidate',
    }),
  },
  globals: { locale: 'ru' },
  play: async ({ canvas }) => {
    const chip = canvas.getByText('В фокусе').closest('.v-chip');
    await expect(chip).not.toBeNull();
    const content = chip?.querySelector('.v-chip__content') as HTMLElement;
    await expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
  },
};

/** Пояснение, что значит «В фокусе», открывается по наведению и по фокусу с клавиатуры. */
export const FocusHint: Story = {
  args: { focused: true },
  globals: { locale: 'ru' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByText('В фокусе'));
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Вы учите этот курс',
      ),
    );
  },
};

export const RecommendedHint: Story = {
  args: { recommended: true },
  globals: { locale: 'ru' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(
      canvas.getByText('Рекомендуем').closest('.v-chip'),
    ).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'С него стоит начать',
      ),
    );
  },
};

export const Tones: Story = {
  render: (args) => ({
    components: { CourseCard },
    setup: () => ({ args }),
    template: `
      <div style="display: flex; flex-wrap: wrap; gap: 16px">
        <div v-for="tone in ['primary', 'secondary', 'info']" :key="tone" style="width: 22rem; max-width: 100%">
          <CourseCard v-bind="args" :tone="tone" />
        </div>
      </div>
    `,
  }),
};

/** Страница курсов: сетка колонок от 20rem, карточки в ряду тянутся по высоте. */
export const Grid: Story = {
  render: (args) => ({
    components: { CourseCard },
    setup: () => ({
      args,
      items: [
        { course: course({ due: 6 }), tone: 'primary', focused: true },
        {
          course: course({
            id: 'sql',
            name: 'SQL с нуля',
            description: undefined,
            status: 'ready',
            attempts: 0,
            lessonsDone: 0,
          }),
          tone: 'secondary',
          recommended: true,
        },
        {
          course: course({
            id: 'algo',
            name: 'Продвинутые структуры данных и алгоритмы для подготовки к собеседованиям',
            status: 'mastered',
            lessonsDone: 12,
          }),
          tone: 'info',
          updateAvailable: true,
        },
        {
          course: course({ id: 'rust', name: 'Rust', status: 'locked' }),
          tone: 'primary',
        },
      ],
    }),
    template: `
      <ul style="display: grid; gap: 16px; padding: 0; margin: 0; list-style: none; grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr))">
        <li v-for="item in items" :key="item.course.id">
          <CourseCard
            v-bind="args"
            :course="item.course"
            :tone="item.tone"
            :focused="item.focused ?? false"
            :recommended="item.recommended ?? false"
            :update-available="item.updateAvailable ?? false"
          />
        </li>
      </ul>
    `,
  }),
};

export const EmitsStudy: Story = {
  globals: { locale: 'ru' },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Учить' }));
    await expect(args.onStudy).toHaveBeenCalledOnce();
    await expect(args.onOpenPlan).not.toHaveBeenCalled();
  },
};

export const EmitsOpenPlanWhenFocused: Story = {
  args: { focused: true },
  globals: { locale: 'ru' },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'План курса' }));
    await expect(args.onOpenPlan).toHaveBeenCalledOnce();
    await expect(args.onStudy).not.toHaveBeenCalled();
  },
};

export const EmitsCheckAndGraph: Story = {
  globals: { locale: 'ru' },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole('button', { name: 'Проверить, что я знаю' }),
    );
    await expect(args.onCheck).toHaveBeenCalledOnce();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Посмотреть граф знаний' }),
    );
    await expect(args.onGraph).toHaveBeenCalledOnce();
  },
};
