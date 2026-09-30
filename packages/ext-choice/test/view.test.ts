// @vitest-environment happy-dom
import { ANSWER_EVENT } from '@spirula-app/extension-api';
import type { AnswerChangeDetail } from '@spirula-app/extension-api';
import { afterEach, describe, expect, it } from 'vitest';
import '../src/view.ts';

interface ChoiceElement extends HTMLElement {
  view: unknown;
  value: unknown;
  disabled: boolean;
}

const single = { multiple: false, options: ['a', 'b', 'c'] };
const multi = { multiple: true, options: ['a', 'b', 'c', 'd'] };

const flush = () => Promise.resolve();

const mountElement = async (view: unknown, label: string | null = null) => {
  const element = document.createElement(
    'spirula-choice-answer',
  ) as ChoiceElement;
  if (label !== null) element.setAttribute('aria-label', label);
  document.body.append(element);
  element.view = view;
  await flush();
  const changes: AnswerChangeDetail[] = [];
  element.addEventListener(ANSWER_EVENT.change, (event) => {
    changes.push((event as CustomEvent<AnswerChangeDetail>).detail);
  });
  return { element, changes };
};

const inputs = (element: HTMLElement) => [
  ...(element.shadowRoot?.querySelectorAll('input') ?? []),
];

const click = (input: HTMLInputElement) => input.click();

afterEach(() => {
  document.body.replaceChildren();
});

describe('spirula-choice-answer', () => {
  it('рисует радиокнопки для одиночного выбора', async () => {
    const { element } = await mountElement(single);
    const radios = inputs(element);
    expect(radios.map((input) => input.type)).toEqual([
      'radio',
      'radio',
      'radio',
    ]);
    expect(
      [...(element.shadowRoot?.querySelectorAll('label') ?? [])].map(
        (label) => label.textContent,
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('рисует чекбоксы для множественного выбора', async () => {
    const { element } = await mountElement(multi);
    expect(new Set(inputs(element).map((input) => input.type))).toEqual(
      new Set(['checkbox']),
    );
  });

  it('ничего не рисует без view', async () => {
    const { element } = await mountElement(undefined);
    expect(inputs(element)).toEqual([]);
  });

  it('радио: выбор заменяет предыдущий и complete = true', async () => {
    const { element, changes } = await mountElement(single);
    const [first, , third] = inputs(element);
    click(first!);
    click(third!);
    expect(changes).toEqual([
      { value: [0], complete: true },
      { value: [2], complete: true },
    ]);
  });

  it('чекбоксы: индексы по возрастанию независимо от порядка кликов', async () => {
    const { element, changes } = await mountElement(multi);
    const boxes = inputs(element);
    click(boxes[3]!);
    click(boxes[1]!);
    click(boxes[3]!);
    expect(changes.map((change) => change.value)).toEqual([[3], [1, 3], [1]]);
  });

  it('снятие последнего чекбокса даёт complete = false', async () => {
    const { element, changes } = await mountElement(multi);
    const [first] = inputs(element);
    click(first!);
    click(first!);
    expect(changes.at(-1)).toEqual({ value: [], complete: false });
  });

  it('value восстанавливает выбор без событий', async () => {
    const { element, changes } = await mountElement(multi);
    element.value = [0, 2, 99, 'x'];
    await flush();
    expect(inputs(element).map((input) => input.checked)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(changes).toEqual([]);
  });

  it('disabled блокирует и разблокирует варианты, не сбрасывая выбор', async () => {
    const { element } = await mountElement(multi);
    click(inputs(element)[1]!);
    element.disabled = true;
    await flush();
    expect(inputs(element).every((input) => input.disabled)).toBe(true);
    expect(inputs(element)[1]?.checked).toBe(true);
    element.disabled = false;
    await flush();
    expect(inputs(element).some((input) => input.disabled)).toBe(false);
  });

  it('disabled, выставленный до view, применяется к вариантам', async () => {
    const element = document.createElement(
      'spirula-choice-answer',
    ) as ChoiceElement;
    document.body.append(element);
    element.disabled = true;
    element.view = single;
    await flush();
    expect(inputs(element).every((input) => input.disabled)).toBe(true);
  });

  it('смена view перерисовывает варианты', async () => {
    const { element } = await mountElement(single);
    element.view = multi;
    await flush();
    expect(inputs(element)).toHaveLength(4);
    expect(inputs(element)[0]?.type).toBe('checkbox');
  });

  it('aria-label хоста попадает на fieldset внутри shadow DOM', async () => {
    const { element } = await mountElement(single, 'Ваш ответ');
    expect(
      element.shadowRoot?.querySelector('fieldset')?.getAttribute('aria-label'),
    ).toBe('Ваш ответ');
  });
});
