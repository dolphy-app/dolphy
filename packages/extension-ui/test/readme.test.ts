// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as ui from '../src/index.ts';

const README = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8');

interface Panel {
  mount(container: HTMLElement): void;
}

/** The first `ts` block of the README, with the import replaced by the kit under test. */
const loadExample = (): Panel => {
  const block = /```ts\n([\s\S]*?)```/.exec(README)?.[1];
  if (block === undefined) throw new Error('README has no ts example');
  const code = block
    .replace(
      /import \{([^}]*)\} from '@dolphy-app\/extension-ui';/,
      'const {$1} = ui;',
    )
    .replace('export default', 'return');
  return new Function('ui', code)(ui) as Panel;
};

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('README example', () => {
  it('mounts, and its handlers drive the status line', () => {
    const container = document.createElement('div');
    document.body.append(container);
    loadExample().mount(container);
    const status = container.querySelector('[role="status"]') as HTMLElement;

    const input = container.querySelector('input') as HTMLInputElement;
    input.value = 'Ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(status.textContent).toBe('Name: Ada');

    (container.querySelector('[role="switch"]') as HTMLElement).click();
    expect(status.textContent).toBe('On');

    const options = container.querySelectorAll<HTMLElement>('[role="option"]');
    options[1]?.click();
    expect(status.textContent).toBe('Selected: js');

    for (const node of container.querySelectorAll('button')) {
      if (node.textContent === 'Save') node.click();
    }
    expect(status.textContent).toBe('Saved');
    expect(
      container.querySelector('section')?.getAttribute('aria-labelledby'),
    ).not.toBeNull();
  });
});
