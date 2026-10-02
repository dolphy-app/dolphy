// @vitest-environment happy-dom
import { loadView } from '@dolphy-app/extension-sdk/testing';
import type { LoadedView } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { views } from '../src/index.ts';

const single = { multiple: false, options: ['a', 'b', 'c'] };
const multi = { multiple: true, options: ['a', 'b', 'c', 'd'] };

const loaded: LoadedView[] = [];

const mountView = async (view: unknown, label?: string) => {
  const result = await loadView(views, 'dolphy.choice', {
    view,
    ...(label === undefined ? {} : { label }),
  });
  loaded.push(result);
  return result;
};

const inputs = (view: LoadedView) => view.queryAll<HTMLInputElement>('input');

const click = (input: HTMLInputElement) => input.click();

afterEach(() => {
  for (const view of loaded.splice(0)) view.dispose();
});

describe('вид dolphy.choice', () => {
  it('рисует радиокнопки для одиночного выбора', async () => {
    const view = await mountView(single);
    const radios = inputs(view);
    expect(radios.map((input) => input.type)).toEqual([
      'radio',
      'radio',
      'radio',
    ]);
    expect(view.queryAll('label').map((label) => label.textContent)).toEqual([
      'a',
      'b',
      'c',
    ]);
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
    click(first!);
    click(third!);
    expect(view.changes).toEqual([
      { value: [0], complete: true },
      { value: [2], complete: true },
    ]);
  });

  it('чекбоксы: индексы по возрастанию независимо от порядка кликов', async () => {
    const view = await mountView(multi);
    const boxes = inputs(view);
    click(boxes[3]!);
    click(boxes[1]!);
    click(boxes[3]!);
    expect(view.changes.map((change) => change.value)).toEqual([
      [3],
      [1, 3],
      [1],
    ]);
  });

  it('снятие последнего чекбокса даёт complete = false', async () => {
    const view = await mountView(multi);
    const [first] = inputs(view);
    click(first!);
    click(first!);
    expect(view.changes.at(-1)).toEqual({ value: [], complete: false });
  });

  it('value восстанавливает выбор без событий', async () => {
    const view = await mountView(multi);
    await view.update({ value: [0, 2, 99, 'x'] });
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
    click(inputs(view)[1]!);
    await view.update({ disabled: true });
    expect(inputs(view).every((input) => input.disabled)).toBe(true);
    expect(inputs(view)[1]?.checked).toBe(true);
    await view.update({ disabled: false });
    expect(inputs(view).some((input) => input.disabled)).toBe(false);
  });

  it('disabled, выставленный до view, применяется к вариантам', async () => {
    const view = await mountView(undefined);
    await view.update({ disabled: true });
    await view.update({ view: single });
    expect(inputs(view).every((input) => input.disabled)).toBe(true);
  });

  it('смена view перерисовывает варианты', async () => {
    const view = await mountView(single);
    await view.update({ view: multi });
    expect(inputs(view)).toHaveLength(4);
    expect(inputs(view)[0]?.type).toBe('checkbox');
  });

  it('aria-label хоста попадает на fieldset внутри shadow DOM', async () => {
    const view = await mountView(single, 'Ваш ответ');
    expect(view.query('fieldset')?.getAttribute('aria-label')).toBe(
      'Ваш ответ',
    );
  });
});
