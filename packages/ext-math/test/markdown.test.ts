// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { markdown } from '../src/index.ts';

const signal = new AbortController().signal;
const render = async (source: string) => {
  const container = document.createElement('div');
  await markdown.math.render(source, container, { language: 'math', signal });
  return container;
};

describe('dolphy.math renderer', () => {
  it('выводит формулу как svg с aria-label', async () => {
    const container = await render('E = mc^2');
    const wrapper = container.querySelector('.dolphy-math');
    expect(wrapper?.getAttribute('role')).toBe('math');
    expect(wrapper?.getAttribute('aria-label')).toBe('E = mc^2');
    expect(wrapper?.querySelector('svg')).not.toBeNull();
  });

  it('ошибочный TeX даёт вывод без исключения', async () => {
    const container = await render('\\frac{1');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('пустой источник отклоняется', async () => {
    await expect(render('  \n ')).rejects.toThrow('empty formula');
  });
});
