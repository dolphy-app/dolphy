# @dolphy-app/extension-ui

Vuetify 4 components for the panels, widgets and answer views of Dolphy
extensions. The look and the behaviour are the ones of the app: radio and
checkbox groups, alerts, chips, progress, text areas, sliders, switches, a date
field, tabs, dialogs, menus, tooltips and tables, themed by the app (light and
dark) and speaking its language (English and Russian).

The package has no root export. You import one subpath per group of components,
and each `mount…` function puts a small Vue app into a DOM element you own:

<!-- example: intro -->

```ts
import { mountRadioGroup } from '@dolphy-app/extension-ui/vuetify/choice';

const group = mountRadioGroup(container, {
  label: 'Pick one',
  items: [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ],
  value: 'a',
  onChange: (value) => group.update({ value }),
});
// later: group.destroy() removes the DOM and the styles
```

You do not write Vue. Every function takes `(container, props)` and returns
`{ update(patch), destroy() }`.

## Install

```sh
pnpm add @dolphy-app/extension-ui
```

`vue` and `vuetify` come with the package. `dolphy-ext build` bundles them into
the file of your extension (`view.mjs`, `panel.mjs` or `widget.mjs`): an
extension frame is isolated (`sandbox="allow-scripts"`, no shared modules with
the app), so every extension that uses the kit carries its own copy. The style
sheets of Vuetify are collected by the build too, so you write no CSS and the
build does not take your own `import './x.css'` for it (that stays an error).

## Subpaths

| Subpath                                       | Components                                                      |
| --------------------------------------------- | --------------------------------------------------------------- |
| `@dolphy-app/extension-ui/vuetify`            | core: `mountComponent`, `vuetifyOf`, `requestOverlayHeight`     |
| `@dolphy-app/extension-ui/vuetify/choice`     | `mountRadioGroup`, `mountCheckboxGroup`                         |
| `@dolphy-app/extension-ui/vuetify/feedback`   | `mountAlert`, `mountChip`, `mountProgress`, `mountSkeleton`     |
| `@dolphy-app/extension-ui/vuetify/fields`     | `mountTextarea`, `mountSlider`, `mountSwitch`, `mountDateField` |
| `@dolphy-app/extension-ui/vuetify/navigation` | `mountTabs`, `mountDialog`, `mountMenu`, `mountTooltip`         |
| `@dolphy-app/extension-ui/vuetify/table`      | `mountTable`, `mountDataTable`                                  |

Import only the subpaths you need: a subpath you do not import adds nothing to
your bundle. The core is shared by all the others.

## How the components work

- **Controlled.** A component shows the props you gave it. When the user picks
  or types, it calls `onChange`; to keep the new value on screen, pass it back
  with `update`. Text fields and switches already feed the reported value back
  into themselves, so `update({ value })` with the text that is shown changes
  nothing (the caret stays).
- **Names and keys.** Pass `label` for every control: it becomes the visible
  label or the `aria-label`. Roles and keyboard control are the ones of Vuetify.
- **Many mounts.** Several components can live in one frame, in one element or
  in a shadow root: the styles are added once per tree and removed with the last
  `destroy()`.
- **Text, not markup.** Strings are set as text; nothing is parsed as HTML.

### Choices and feedback

<!-- example: choice-and-feedback -->

```ts
import { mountRadioGroup } from '@dolphy-app/extension-ui/vuetify/choice';
import { mountAlert } from '@dolphy-app/extension-ui/vuetify/feedback';

export const mount = (
  container: Element,
  report: (text: string) => void,
): (() => void) => {
  const choices = document.createElement('div');
  const feedback = document.createElement('div');
  container.append(choices, feedback);

  const alert = mountAlert(feedback, {
    type: 'info',
    text: 'Pick an answer.',
  });
  const radio = mountRadioGroup<number>(choices, {
    label: 'The capital of France',
    items: [
      { value: 0, label: 'Berlin' },
      { value: 1, label: 'Paris' },
    ],
    value: null,
    onChange: (value) => {
      radio.update({ value });
      alert.update(
        value === 1
          ? { type: 'success', text: 'Correct.' }
          : { type: 'error', text: 'Try again.' },
      );
      report(`picked ${value}`);
    },
  });
  return () => {
    radio.destroy();
    alert.destroy();
  };
};
```

`mountCheckboxGroup` takes a `value` list and reports the whole selection.
`error: true` draws a group as invalid; `disabled` locks it. `mountChip`,
`mountProgress` (`value` 0–100 or `null` for an indeterminate bar, `shape:
'circular'` for a ring) and `mountSkeleton` follow the same pattern.

### Fields

<!-- example: fields -->

```ts
import {
  mountDateField,
  mountSwitch,
  mountTextarea,
} from '@dolphy-app/extension-ui/vuetify/fields';

export const mount = (
  container: Element,
  report: (text: string) => void,
): (() => void) => {
  const slot = () => container.appendChild(document.createElement('div'));
  const [text, flag, date] = [slot(), slot(), slot()];

  const area = mountTextarea(text, {
    label: 'Your query',
    value: '',
    monospace: true,
    spellcheck: false,
    onChange: (value) => report(`text: ${value}`),
    // Ctrl/Cmd+Enter inside the field
    onSubmit: () => report('submit'),
  });
  const toggle = mountSwitch(flag, {
    label: 'Show hints',
    value: false,
    onChange: (value) => report(`hints: ${value}`),
  });
  const deadline = mountDateField(date, {
    label: 'Deadline',
    value: '2026-10-05', // an ISO date `YYYY-MM-DD`, or `null` for empty
    onChange: (value) => report(`deadline: ${value}`),
  });
  return () => {
    area.destroy();
    toggle.destroy();
    deadline.destroy();
  };
};
```

`mountSlider` takes `min`, `max`, `step` and `value`. `mountTextarea` also has
`rows`, `autoGrow`, `readonly`, `placeholder` and `error`.

### Tables

<!-- example: tables -->

```ts
import { mountDataTable } from '@dolphy-app/extension-ui/vuetify/table';

export const mount = (
  container: Element,
  report: (text: string) => void,
): (() => void) => {
  const table = mountDataTable(container, {
    caption: 'Results',
    columns: [
      { key: 'name', title: 'Name' },
      { key: 'score', title: 'Score', align: 'end' },
    ],
    rows: [
      { name: 'Ada', score: 9 },
      { name: 'Linus', score: 7 },
    ],
    itemsPerPage: 10,
    onSort: (sortBy) => report(`sorted by ${sortBy[0]?.key ?? 'nothing'}`),
    onRowClick: (row) => report(`opened ${String(row.name)}`),
  });
  // `search` filters rows by any cell: table.update({ search: 'ada' })
  return table.destroy;
};
```

`mountTable` is the static version (no sorting, search or paging; `fixedHeader`
with `height` keeps the header in view). The built-in strings of the data table
("no data", paging) follow the language of the frame; `emptyText` replaces the
"no data" one.

### Tabs

<!-- example: tabs -->

```ts
import { mountTable } from '@dolphy-app/extension-ui/vuetify/table';
import { mountTabs } from '@dolphy-app/extension-ui/vuetify/navigation';

export const mount = (
  container: Element,
  report: (text: string) => void,
): (() => void) => {
  const inner = new Map<string, { destroy(): void }>();
  const tabs = mountTabs<string>(container, {
    label: 'Sections',
    items: [
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
    ],
    value: 'week',
    onChange: (value) => {
      tabs.update({ value });
      report(`tab: ${value}`);
    },
    // the tabs give you the element of every panel to render into
    onPanel: (value, element) => {
      inner.get(value)?.destroy();
      inner.delete(value);
      if (element === null) return;
      inner.set(
        value,
        mountTable(element, {
          caption: value,
          columns: [{ key: 'topic', title: 'Topic' }],
          rows: [{ topic: `Lessons of the ${value}` }],
        }),
      );
    },
  });
  return () => {
    tabs.destroy();
    for (const item of inner.values()) item.destroy();
  };
};
```

Only the panel of the selected tab is visible; the others stay in the document,
hidden, so what you rendered into them lives on.

### Dialogs, menus and tooltips

<!-- example: overlays -->

```ts
import {
  mountDialog,
  mountMenu,
  mountTooltip,
} from '@dolphy-app/extension-ui/vuetify/navigation';

export const mount = (
  container: Element,
  report: (text: string) => void,
): (() => void) => {
  const slot = () => container.appendChild(document.createElement('div'));
  const [menuHost, tipHost, dialogHost] = [slot(), slot(), slot()];

  const dialog = mountDialog<'delete' | 'keep'>(dialogHost, {
    open: false,
    title: 'Delete the note?',
    content: 'This cannot be undone.',
    actions: [
      { label: 'Keep', value: 'keep' },
      { label: 'Delete', value: 'delete', color: 'error' },
    ],
    // an action value, or `null` for Escape and a click outside
    onClose: (value) => {
      dialog.update({ open: false });
      report(`dialog: ${value}`);
    },
  });
  const menu = mountMenu<string>(menuHost, {
    label: 'Actions',
    items: [
      { value: 'rename', label: 'Rename' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (value) => {
      report(`menu: ${value}`);
      if (value === 'delete') dialog.update({ open: true });
    },
  });
  const tip = mountTooltip(tipHost, {
    label: 'Help',
    text: 'Actions work on the selected note.',
  });
  return () => {
    menu.destroy();
    tip.destroy();
    dialog.destroy();
  };
};
```

A dialog's `content` is a string or a DOM element the dialog adopts into its
body.

## Overlays in frames

A dialog, a menu and a tooltip are drawn inside the mount element, not on
`<body>`, so they stay inside the styles of an answer view's shadow root. A
frame, however, clips what leaves its border, and the frame of an answer view, a
markdown block or a widget is only as tall as its content. For this the kit
sends the `dolphy-overlay` event while an overlay is open; the app then makes
the frame taller and restores its height when the overlay closes.

- The app caps the requested height at the height of its window. A dialog taller
  than the window is clipped.
- A panel fills its frame, so the event changes nothing there.
- The room a menu or a tooltip gets is measured from the bottom edge of its
  button; keep free space below the mount element, or use them in a panel.

`requestOverlayHeight(document, key, height | null)` from the core subpath
reports the height for an overlay you draw yourself (`key` is a `Symbol` of your
overlay).

## Theme and language

Colours come from the `--v-theme-*` variables the frame receives from the app
(the Vuetify theme is built from them and follows the app when the theme
changes). The language is `en` or `ru` by `<html lang>` of the frame and updates
when it changes. You write no theme code.

## Core

`mountComponent(container, component, props)` from `@dolphy-app/extension-ui/vuetify`
mounts a Vue component of your own on the same Vuetify, with the same overlay
attachment and style handling; `vuetifyOf(document)` returns the instance. The
component must list the keys of `props` in its `props` option. Most extensions
need only the components above.

## Size

Each extension that imports a subpath carries Vue, the core of Vuetify, the
components it uses and the Vuetify style sheet. An extension with a radio group
and a checkbox group measured about 549 KB (about 118 KB gzipped) as
`dolphy-ext build` writes it before minification. Import only the subpaths you
use.

The release checks of the repository build an extension with each subpath and
measure the minified bundle (gzip, JS / CSS in KiB): the core 44.6 / 26.7, `choice` 57.6 / 28.6, `feedback`
69.6 / 34.6, `fields` 102.0 / 39.0, `navigation` 92.8 / 36.3, `table` 137.9 /
40.9, everything together 167.5 / 49.1 (each bundle includes the core). The
check fails when a subpath grows more than about 10% over its measured size, and
a subpath never carries the components of another one.
