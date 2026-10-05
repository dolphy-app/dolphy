# Recipe: a panel on the UI kit

`@dolphy-app/extension-ui` gives a panel ready, accessible elements, so you do
not write markup, keyboard handling or dark-theme colours yourself. This recipe
has no template of its own: start from `blank`, install the kit
(`pnpm add @dolphy-app/extension-ui`) and replace the three files below, which
are checked as a whole project. See [quick-start.md](quick-start.md) for the
commands.

## The manifest

File `extension.json` (ui-kit):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello notes",
  "description": "A panel with a text field, a button and a list built on the UI kit.",
  "author": "your-github-login",
  "tags": ["productivity"],
  "contributes": {
    "panels": [{ "id": "acme.hello.view", "title": "Notes" }]
  }
}
```

## The code

File `src/index.ts` (ui-kit):

```ts
import { defineExtensionPanel } from '@dolphy-app/extension-sdk';
import type { ExtensionPanels } from '@dolphy-app/extension-sdk';
import {
  button,
  card,
  emptyState,
  list,
  textField,
} from '@dolphy-app/extension-ui';

export const panels = {
  'acme.hello.view': defineExtensionPanel({
    mount(container) {
      const notes: string[] = [];
      let draft = '';
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      const body = document.createElement('div');
      // elements are static: draw the list again with replaceChildren
      const render = () => {
        body.replaceChildren(
          notes.length === 0
            ? emptyState({
                title: 'No notes yet',
                description: 'Type a note and press Add.',
              })
            : list({
                label: 'Notes',
                emptyText: 'No notes',
                items: notes.map((note, index) => ({
                  id: String(index),
                  label: note,
                })),
                onSelect: (id) => {
                  status.textContent = `Selected note ${Number(id) + 1}`;
                },
              }),
        );
      };
      render();
      container.append(
        card({
          title: 'Notes',
          children: [
            textField({
              label: 'Note text',
              onInput: (value) => {
                draft = value;
              },
            }),
            button({
              label: 'Add',
              variant: 'primary',
              onClick: () => {
                if (draft.trim() === '') return;
                notes.push(draft.trim());
                status.textContent = `Notes: ${notes.length}`;
                render();
              },
            }),
            body,
          ],
        }),
        status,
      );
    },
  }),
} satisfies ExtensionPanels;
```

- `list`, `button`, `textField`, `select`, `toggle`, `card` and `emptyState`
  return DOM elements you append yourself. Each has a role, a visible name and
  keyboard control (a `list` is one tab stop, arrows move, Enter or Space
  select).
- Colours and spacing come from the CSS variables of the frame theme, so the
  light and the dark theme work with no code of yours. Text is always set as
  `textContent`; the kit never parses markup.
- Elements keep no state of their own. To change a list, build a new one and
  call `replaceWith` / `replaceChildren`.
- The whole kit is under 10 KiB gzipped, and it adds no permission: the panel
  still runs in the isolated frame with no network.

## The test

File `test/index.test.ts` (ui-kit):

```ts
// @vitest-environment happy-dom
import { loadPanel } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { panels } from '../src/index.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

describe('acme.hello: panel', () => {
  it('starts with an empty state and lists an added note', async () => {
    const panel = await loadPanel(panels, 'acme.hello.view');
    disposables.push(panel);
    expect(panel.container.textContent).toContain('No notes yet');

    const input = panel.container.querySelector('input') as HTMLInputElement;
    input.value = 'Buy milk';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const add = [...panel.container.querySelectorAll('button')].find(
      (element) => element.textContent === 'Add',
    ) as HTMLButtonElement;
    add.click();

    const options = panel.container.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Buy milk');
    expect(panel.container.querySelector('[role="status"]')?.textContent).toBe(
      'Notes: 1',
    );
  });

  it('ignores an empty note', async () => {
    const panel = await loadPanel(panels, 'acme.hello.view');
    disposables.push(panel);
    const add = [...panel.container.querySelectorAll('button')].find(
      (element) => element.textContent === 'Add',
    ) as HTMLButtonElement;
    add.click();
    expect(panel.container.textContent).toContain('No notes yet');
  });
});
```

`loadPanel` mounts the panel in happy-dom the way the frame does. The kit's
own tests check its roles and keys; test what your panel does with them.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS` and open the panel
from the sidebar. Switch the theme in Settings → Appearance: the panel follows.
