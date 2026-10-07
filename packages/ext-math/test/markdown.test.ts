// @vitest-environment happy-dom
import { createTestClient } from '@dolphy-app/extension-sdk/testing';
import { describe, expect, it } from 'vitest';
import { createApp, h } from 'vue';
import { client } from '../src/index.ts';
import { MathBlock } from '../src/math-block.ts';

const render = (source: string) => {
  const host = document.createElement('div');
  const errors: unknown[] = [];
  const app = createApp({
    render: () => h(MathBlock, { source, language: 'math' }),
  });
  app.config.errorHandler = (error) => errors.push(error);
  app.mount(host);
  return { host, errors };
};

describe('dolphy.math renderer', () => {
  it('добавляет рендерер блоков math', async () => {
    const running = await createTestClient(client, {
      extensionId: 'dolphy.math',
    });
    expect(running.markdownRenderers.get('math')).toBe(MathBlock);
    await running.dispose();
  });

  it('выводит формулу как svg с aria-label', () => {
    const { host, errors } = render('E = mc^2');
    const wrapper = host.querySelector('.dolphy-math');
    expect(errors).toEqual([]);
    expect(wrapper?.getAttribute('role')).toBe('math');
    expect(wrapper?.getAttribute('aria-label')).toBe('E = mc^2');
    expect(wrapper?.querySelector('svg')).not.toBeNull();
  });

  it('ошибочный TeX даёт вывод без исключения', () => {
    const { host, errors } = render('\\frac{1');
    expect(errors).toEqual([]);
    expect(host.querySelector('svg')).not.toBeNull();
  });

  it('пустой источник отклоняется', () => {
    const { errors } = render('  \n ');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(new Error('empty formula'));
  });
});
