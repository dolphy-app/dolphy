import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const README = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8');

// happy-dom has no visual viewport, Vuetify positions menus against it
vi.stubGlobal('visualViewport', {
  scale: 1,
  width: 1024,
  height: 768,
  offsetLeft: 0,
  offsetTop: 0,
  addEventListener() {},
  removeEventListener() {},
});

type Dispose = () => void;
interface Example {
  mount(container: Element, report: (text: string) => void): Dispose;
}

const scratch = mkdtempSync(join(import.meta.dirname, '.readme-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Every `ts` block of the README follows `<!-- example: name -->`. */
const blocks = new Map<string, string>();
for (const [, name = '', code = ''] of README.matchAll(
  /<!-- example: ([\w-]+) -->\n\n```ts\n([\s\S]*?)```/g,
)) {
  blocks.set(name, code);
}

const source = (code: string): string =>
  code.replaceAll(
    /'@dolphy-app\/extension-ui\/vuetify(\/\w+)?'/g,
    (_, subpath: string | undefined) =>
      `'../src/vuetify${subpath === undefined ? '/index' : subpath}.ts'`,
  );

/** The block as a module next to the test, so that its imports resolve to the sources. */
const load = async (name: string): Promise<Example> => {
  const code = blocks.get(name);
  if (code === undefined) throw new Error(`README has no example ${name}`);
  const file = join(scratch, `${name}.ts`);
  writeFileSync(file, source(code).replaceAll("'../src/", "'../../src/"));
  return (await import(/* @vite-ignore */ file)) as Example;
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await nextTick();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const disposers: Dispose[] = [];
const run = async (name: string) => {
  const container = document.createElement('div');
  document.body.append(container);
  const reports: string[] = [];
  const example = await load(name);
  disposers.push(example.mount(container, (text) => reports.push(text)));
  await flush();
  return { container, reports };
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

describe('README examples', () => {
  it('has a test for every example, and every ts block is an example', () => {
    expect([...blocks.keys()].sort()).toEqual([
      'choice-and-feedback',
      'fields',
      'intro',
      'overlays',
      'tables',
      'tabs',
    ]);
    expect(README.match(/```ts\n/g)).toHaveLength(blocks.size);
  });

  it('intro: a radio group that keeps the picked value', async () => {
    const code = blocks.get('intro') ?? '';
    const file = join(scratch, 'intro.ts');
    // the snippet expects a `container`; the test provides it and reads `group` back
    writeFileSync(
      file,
      `${source(code).replaceAll("'../src/", "'../../src/")}\nexport { group };\n`.replace(
        '\nconst group',
        "\nconst container = document.body.appendChild(document.createElement('div'));\nconst group",
      ),
    );
    const { group } = (await import(/* @vite-ignore */ file)) as {
      group: { destroy(): void };
    };
    await flush();
    const inputs = [...document.querySelectorAll('input')];
    expect(inputs.map((input) => input.checked)).toEqual([true, false]);
    inputs[1]?.click();
    await flush();
    expect(inputs.map((input) => input.checked)).toEqual([false, true]);
    disposers.push(() => group.destroy());
  });

  it('choice-and-feedback: a pick is reported and answered by the alert', async () => {
    const { container, reports } = await run('choice-and-feedback');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Pick an answer.',
    );
    container.querySelectorAll('input')[1]?.click();
    await flush();
    expect(reports).toEqual(['picked 1']);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Correct.',
    );
    expect(container.querySelectorAll('input')[1]?.checked).toBe(true);
  });

  it('fields: text, switch and date report what the user does', async () => {
    const { container, reports } = await run('fields');
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.getAttribute('aria-label')).toBe('Your query');
    area.value = 'select 1';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
    );
    container.querySelector<HTMLElement>('input[role="switch"]')?.click();
    await flush();
    expect(reports).toEqual(['text: select 1', 'submit', 'hints: true']);
    const dateInput = [...container.querySelectorAll('input')].find(
      (input) => input.getAttribute('aria-label') === 'Deadline',
    );
    expect(dateInput?.value).toMatch(/2026/);
  });

  it('tables: a named table with the rows, and a click on a row is reported', async () => {
    const { container, reports } = await run('tables');
    expect(container.querySelector('table')?.getAttribute('aria-label')).toBe(
      'Results',
    );
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual([
      'Ada',
      'Linus',
    ]);
    (rows[1] as HTMLElement).click();
    expect(reports).toEqual(['opened Linus']);
  });

  it('tabs: every panel gets its content and only the selected one is shown', async () => {
    const { container, reports } = await run('tabs');
    const panels = [
      ...container.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
    ];
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true]);
    expect(panels.map((panel) => panel.textContent)).toEqual([
      expect.stringContaining('Lessons of the week'),
      expect.stringContaining('Lessons of the month'),
    ]);
    container.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click();
    await flush();
    expect(reports).toEqual(['tab: month']);
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false]);
  });

  it('overlays: the menu opens the dialog, and the dialog reports its action', async () => {
    const { container, reports } = await run('overlays');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const activator = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Actions',
    );
    activator?.click();
    await flush();
    const item = [
      ...container.querySelectorAll<HTMLElement>('.v-list-item'),
    ].find((element) => element.textContent?.includes('Delete'));
    item?.click();
    await flush();
    expect(reports).toEqual(['menu: delete']);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('This cannot be undone.');
    [...(dialog?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent === 'Keep')
      ?.click();
    await flush();
    expect(reports).toEqual(['menu: delete', 'dialog: keep']);
  });
});
