# @dolphy-app/extension-ui

Accessible DOM building blocks for Dolphy extension panels and views. Vanilla TypeScript, no dependencies, under 10 KiB gzipped (checked by a unit test and by `pnpm verify:packages`).

Every function returns a DOM element you append yourself. Each element has a role, a visible accessible name and keyboard control. Colours come from the CSS variables of the frame theme (`--v-theme-*`, `--v-border-*`), which the app sends to every extension frame, so the dark theme works without any code on your side. Text is always set as `textContent`; nothing here parses markup.

| Function                                                 | Element                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `button({ label, onClick, variant?, disabled? })`        | `<button>`; `variant` is `primary`, `secondary` (default) or `danger`                                        |
| `textField({ label, value?, description?, error?, … })`  | label + `<input>`; `error` sets `aria-invalid`; `type` is `text`, `email`, `number`, `password`, `search`, … |
| `select({ label, options, value?, onChange? })`          | label + native `<select>`                                                                                    |
| `toggle({ label, checked?, onChange? })`                 | `role="switch"` button, Space or Enter flips it                                                              |
| `list({ label, items, selected?, emptyText, onSelect })` | `role="listbox"`; one tab stop, arrows, Home and End move, Enter, Space or a click select                    |
| `card({ title, level?, children? })`                     | `<section>` named by its heading                                                                             |
| `emptyState({ title, description?, action? })`           | a group named by its heading, with an optional next step                                                     |

The stylesheet is one `<style id="dolphy-ui-kit">` in the frame document, inserted when the first element is built. It also paints the page body with the theme background so text contrast holds on a transparent frame.

Elements are static: to change a list, build a new one and call `replaceWith`.

## Example

A panel (`src/panel.ts` of an extension project):

```ts
import {
  button,
  card,
  list,
  textField,
  toggle,
} from '@dolphy-app/extension-ui';

export default {
  mount(container) {
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const say = (text) => {
      status.textContent = text;
    };
    container.append(
      card({
        title: 'Profile',
        children: [
          textField({
            label: 'Name',
            description: 'How to address you',
            onInput: (value) => say(`Name: ${value}`),
          }),
          toggle({
            label: 'Send reminders',
            onChange: (checked) => say(checked ? 'On' : 'Off'),
          }),
          list({
            label: 'Courses',
            emptyText: 'No courses',
            items: [
              { id: 'sql', label: 'SQL', description: 'Queries and schemas' },
              { id: 'js', label: 'JavaScript' },
            ],
            selected: 'sql',
            onSelect: (id) => say(`Selected: ${id}`),
          }),
          button({
            label: 'Save',
            variant: 'primary',
            onClick: () => say('Saved'),
          }),
        ],
      }),
      status,
    );
  },
};
```

The e2e panel `apps/desktop/e2e/fixtures/ui-kit-extension` is built on this package and is checked with axe (serious and critical rules) in the light and the dark theme.
