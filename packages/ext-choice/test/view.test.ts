// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { views } from '../src/index.ts';
import { mountView as mount } from './mount-view.ts';
import type { MountedView } from './mount-view.ts';

const single = { multiple: false, options: ['a', 'b', 'c'] };
const multi = { multiple: true, options: ['a', 'b', 'c', 'd'] };

const loaded: MountedView[] = [];

/** Vue рисует на следующем тике: ждём его после каждого действия. */
const settle = async () => {
  await nextTick();
  await nextTick();
};

const mountView = async (view: unknown, label?: string) => {
  const result = await mount(views['dolphy.choice'], {
    view,
    ...(label === undefined ? {} : { label }),
  });
  loaded.push(result);
  return result;
};

const inputs = (view: MountedView) => view.queryAll<HTMLInputElement>('input');

const click = async (input: HTMLInputElement) => {
  input.click();
  await settle();
};

const update = async (view: MountedView, props: Record<string, unknown>) => {
  await view.update(props);
  await settle();
};

afterEach(() => {
  for (const view of loaded.splice(0)) view.dispose();
});

describe('вид dolphy.choice', () => {
  it('рисует радиокнопки для одиночного выбора', async () => {
    const view = await mountView(single);
    expect(inputs(view).map((input) => input.type)).toEqual([
      'radio',
      'radio',
      'radio',
    ]);
    expect(
      view.queryAll('label').map((label) => label.textContent?.trim()),
    ).toEqual(['a', 'b', 'c']);
  });

  it('рисует чекбоксы для множественного выбора', async () => {
    const view = await mountView(multi);
    expect(new Set(inputs(view).map((input) => input.type))).toEqual(
      new Set(['checkbox']),
    );
  });

  it('ничего не рисует без view', async () => {
    const view = await mountView(undefined);
    expect(inputs(view)).toEqual([]);
  });

  it('радио: выбор заменяет предыдущий и complete = true', async () => {
    const view = await mountView(single);
    const [first, , third] = inputs(view);
    await click(first!);
    await click(third!);
    expect(view.changes).toEqual([
      { value: [0], complete: true },
      { value: [2], complete: true },
    ]);
    expect(inputs(view).map((input) => input.checked)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('чекбоксы: индексы по возрастанию независимо от порядка кликов', async () => {
    const view = await mountView(multi);
    const boxes = inputs(view);
    await click(boxes[3]!);
    await click(boxes[1]!);
    await click(boxes[3]!);
    expect(view.changes.map((change) => change.value)).toEqual([
      [3],
      [1, 3],
      [1],
    ]);
  });

  it('снятие последнего чекбокса даёт complete = false', async () => {
    const view = await mountView(multi);
    const [first] = inputs(view);
    await click(first!);
    await click(first!);
    expect(view.changes.at(-1)).toEqual({ value: [], complete: false });
  });

  it('value восстанавливает выбор без событий', async () => {
    const view = await mountView(multi);
    await update(view, { value: [0, 2, 99, 'x'] });
    expect(inputs(view).map((input) => input.checked)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(view.changes).toEqual([]);
  });

  it('disabled блокирует и разблокирует варианты, не сбрасывая выбор', async () => {
    const view = await mountView(multi);
    await click(inputs(view)[1]!);
    await update(view, { disabled: true });
    expect(inputs(view).every((input) => input.disabled)).toBe(true);
    expect(inputs(view)[1]?.checked).toBe(true);
    await update(view, { disabled: false });
    expect(inputs(view).some((input) => input.disabled)).toBe(false);
  });

  it('disabled, выставленный до view, применяется к вариантам', async () => {
    const view = await mountView(undefined);
    await update(view, { disabled: true });
    await update(view, { view: single });
    expect(inputs(view).every((input) => input.disabled)).toBe(true);
  });

  it('смена view перерисовывает варианты', async () => {
    const view = await mountView(single);
    await update(view, { view: multi });
    expect(inputs(view)).toHaveLength(4);
    expect(inputs(view)[0]?.type).toBe('checkbox');
  });

  it('выбор, введённый пользователем, не стирается обновлением disabled', async () => {
    const view = await mountView(single);
    await click(inputs(view)[1]!);
    await update(view, { disabled: true });
    expect(inputs(view).map((input) => input.checked)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('prop label становится именем группы', async () => {
    const radios = await mountView(single, 'Ваш ответ');
    expect(
      radios.query('[role="radiogroup"]')?.getAttribute('aria-label'),
    ).toBe('Ваш ответ');
    const boxes = await mountView(multi, 'Ваши ответы');
    expect(boxes.query('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Ваши ответы',
    );
  });
});
