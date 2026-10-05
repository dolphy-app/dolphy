# Recipe: a panel and an answer view on the UI kit

`@dolphy-app/extension-ui` gives panels, widgets and answer views the Vuetify
components of the app: radio and checkbox groups, alerts, chips, progress, text
areas, sliders, switches, a date field, tabs, dialogs, menus, tooltips and
tables. You do not write Vue, markup, keyboard handling or dark-theme colours.
This recipe has no template of its own: start from `blank`, install the kit
(`pnpm add @dolphy-app/extension-ui`) and replace the three files below, which
are checked as a whole project. See [quick-start.md](quick-start.md) for the
commands.

The example is one extension with two screens: a multiple-choice exercise type
whose answer view is a radio group, and a panel that shows results in a table.

## The manifest

File `extension.json` (ui-kit):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Quiz",
  "description": "A multiple-choice exercise type and a results panel built on the UI kit.",
  "author": "your-github-login",
  "tags": ["learning"],
  "contributes": {
    "exerciseTypes": [
      {
        "id": "acme.hello",
        "specSchema": {
          "type": "object",
          "required": ["options", "correct"],
          "additionalProperties": false,
          "properties": {
            "options": {
              "type": "array",
              "minItems": 2,
              "maxItems": 8,
              "items": { "type": "string", "minLength": 1 }
            },
            "correct": { "type": "integer", "minimum": 0 }
          }
        },
        "answerSchema": { "type": "integer", "minimum": 0 }
      }
    ],
    "panels": [{ "id": "acme.hello.results", "title": "Quiz results" }]
  }
}
```

## The code

File `src/index.ts` (ui-kit):

```ts
import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
  defineExtensionPanel,
} from '@dolphy-app/extension-sdk';
import type {
  ExtensionPanels,
  ExtensionViews,
} from '@dolphy-app/extension-sdk';
import { mountRadioGroup } from '@dolphy-app/extension-ui/vuetify/choice';
import {
  mountAlert,
  mountProgress,
} from '@dolphy-app/extension-ui/vuetify/feedback';
import { mountDataTable } from '@dolphy-app/extension-ui/vuetify/table';

interface Spec {
  options: string[];
  correct: number;
}

/** What the window may see: the options, never the right one. */
interface Visible {
  options: string[];
}

// extension code: runs in the extension process of the app
export const host = defineExtension({
  exerciseTypes: {
    'acme.hello': defineExerciseType<Spec, number, Visible>({
      project: ({ spec }) => ({ options: spec.options }),
      grade: ({ spec, answer }) =>
        answer === spec.correct
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'wrong option' },
      referenceAnswer: ({ spec }) => spec.correct,
    }),
  },
});

const optionsOf = (view: unknown): string[] =>
  typeof view === 'object' &&
  view !== null &&
  Array.isArray((view as Visible).options)
    ? (view as Visible).options
    : [];

const indexOf = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

// the answer input: runs in the app window, in the shadow root of the element
export const views = {
  'acme.hello': defineAnswerView((api, initial) => {
    const container = document.createElement('div');
    api.root.append(container);
    let applied = initial.value;
    const group = mountRadioGroup<number>(container, {
      label: api.label,
      items: optionsOf(initial.view).map((label, value) => ({ value, label })),
      value: indexOf(applied),
      disabled: initial.disabled,
      onChange: (value) => {
        // a component shows what you give it: keep the pick on screen
        group.update({ value });
        api.setAnswer(value, true);
      },
    });
    return {
      update: (props) => {
        group.update({
          items: optionsOf(props.view).map((label, value) => ({
            value,
            label,
          })),
          disabled: props.disabled,
        });
        // apply the value only when the app really changed it
        if (props.value !== applied) {
          applied = props.value;
          group.update({ value: indexOf(applied) });
        }
      },
      destroy: group.destroy,
    };
  }),
} satisfies ExtensionViews;

const results = [
  { learner: 'Ada', score: 9 },
  { learner: 'Grace', score: 7 },
  { learner: 'Linus', score: 4 },
];
const PASS_MARK = 6;

// the panel: runs in an isolated frame; it fills the frame
export const panels = {
  'acme.hello.results': defineExtensionPanel({
    mount(container, ctx) {
      const slot = () => container.appendChild(document.createElement('div'));
      const passed = results.filter((row) => row.score >= PASS_MARK).length;
      const progress = mountProgress(slot(), {
        label: 'Passed',
        value: Math.round((passed / results.length) * 100),
      });
      const alert = mountAlert(slot(), {
        type: 'info',
        text: 'Select a row to see the result.',
      });
      const table = mountDataTable(slot(), {
        caption: 'Results',
        columns: [
          { key: 'learner', title: 'Learner' },
          { key: 'score', title: 'Score', align: 'end' },
        ],
        rows: results,
        onRowClick: (row) => {
          alert.update({
            type: Number(row.score) >= PASS_MARK ? 'success' : 'warning',
            text: `${String(row.learner)}: ${String(row.score)} of 10`,
          });
        },
      });
      // the frame is closed: remove the components and their styles
      ctx.signal.addEventListener('abort', () => {
        progress.destroy();
        alert.destroy();
        table.destroy();
      });
    },
  }),
} satisfies ExtensionPanels;
```

- Every component is a function `mount…(container, props)` that returns
  `{ update(patch), destroy() }`. One subpath per group of components:
  `…/vuetify/choice`, `…/feedback`, `…/fields`, `…/navigation` and `…/table`
  (there is no root import). Import only the ones you use: a subpath you do not
  import adds nothing to the bundle.
- Components are controlled. When the user picks an option the component calls
  `onChange` and shows the old value until you pass the new one with `update`.
- Always pass `label`: it is the accessible name. Roles and keyboard control are
  the ones of Vuetify.
- Colours and strings come from the frame: the theme from its `--v-theme-*`
  variables (light and dark, no code of yours) and the language from
  `<html lang>` (English and Russian).
- Vue and Vuetify are bundled into `view.mjs` and `panel.mjs` by
  `dolphy-ext build`, together with the Vuetify style sheets you use. Each
  extension carries its own copy, so the kit adds tens of kilobytes to an
  extension (a radio group alone measured about 118 KB gzipped before
  minification) and no permission: the code still runs in the isolated frame
  with no network.
- Dialogs, menus and tooltips (`…/vuetify/navigation`) work in a panel, an answer
  view and a widget: the app makes the frame taller while one is open, up to the
  height of its window. See the package README.

## The tests

File `test/index.test.ts` (ui-kit):

```ts
// @vitest-environment happy-dom
import { loadExerciseType, loadPanel, loadView } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { host, panels, views } from '../src/index.ts';

const spec = { options: ['Berlin', 'Paris', 'Rome'], correct: 1 };

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

// Vue renders on the next ticks
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });

describe('acme.hello: handler', () => {
  it('projects the options without the right one, grades the pick', async () => {
    const type = await loadExerciseType(host, 'acme.hello');
    disposables.push(type);
    expect(await type.project(spec)).toEqual({ options: spec.options });
    expect(await type.grade({ spec, answer: 1 })).toEqual({
      outcome: 'passed',
    });
    expect(await type.grade({ spec, answer: 0 })).toEqual({
      outcome: 'failed',
      reason: 'wrong option',
    });
  });
});

describe('acme.hello: answer view', () => {
  const mount = async () => {
    const view = await loadView(views, 'acme.hello', {
      label: 'The capital of France',
      view: { options: spec.options },
    });
    disposables.push(view);
    await settle();
    return view;
  };

  it('is a named radio group; a pick is reported and stays selected', async () => {
    const view = await mount();
    const group = view.query('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('The capital of France');
    const radios = view.queryAll<HTMLInputElement>('input');
    expect(radios).toHaveLength(3);

    radios[1]?.click();
    await settle();
    expect(view.changes).toEqual([{ value: 1, complete: true }]);
    expect(radios.map((radio) => radio.checked)).toEqual([false, true, false]);
  });

  it('restores a value without events and locks the group when disabled', async () => {
    const view = await mount();
    await view.update({ value: 2, disabled: true });
    await settle();
    const radios = view.queryAll<HTMLInputElement>('input');
    expect(radios.map((radio) => radio.checked)).toEqual([false, false, true]);
    expect(radios.every((radio) => radio.disabled)).toBe(true);
    expect(view.changes).toEqual([]);
  });
});

describe('acme.hello: results panel', () => {
  it('shows the results and answers a click on a row', async () => {
    const panel = await loadPanel(panels, 'acme.hello.results');
    disposables.push(panel);
    await settle();
    const table = panel.container.querySelector('table');
    expect(table?.getAttribute('aria-label')).toBe('Results');
    const rows = [...panel.container.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual([
      'Ada',
      'Grace',
      'Linus',
    ]);
    expect(
      panel.container.querySelector('[role="progressbar"]'),
    ).not.toBeNull();

    (rows[2] as HTMLElement).click();
    await settle();
    expect(panel.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Linus: 4 of 10',
    );
  });

  it('removes its components when the frame closes', async () => {
    const panel = await loadPanel(panels, 'acme.hello.results');
    await settle();
    await panel.dispose();
    expect(panel.container.querySelector('table')).toBeNull();
  });
});
```

Vuetify imports its style sheets from its modules, and Node cannot load a
`.css` file. Tell Vitest to process Vuetify itself:

File `vitest.config.ts` (ui-kit):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vuetify imports style sheets from its modules: Vite has to process them
    server: { deps: { inline: ['vuetify'] } },
  },
});
```

`loadView` and `loadPanel` mount your code in happy-dom the way the app does.
The kit's own tests check its roles and keys; test what your screens do with
them. Vue updates the DOM on the next ticks, so wait a moment (`settle`) after a
click before you read the result.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open the panel from
the sidebar and add an exercise of the type `acme.hello` to a course. Switch the
theme in Settings → Appearance: both screens follow.
