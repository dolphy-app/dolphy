import { INITIAL_VERSION, idsBullet } from './common.ts';
import type { TemplateModule } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Hello panel",
  "description": "Palette commands that greet the learner and open a small panel.",
  "author": "your-github-login",
  "tags": ["productivity"],
  "contributes": {
    "commands": [
      { "id": "${id}.hello", "title": "Say hello", "category": "Hello" },
      { "id": "${id}.open", "title": "Open the hello panel", "category": "Hello" },
      { "id": "${id}.data", "title": "Hello panel data", "palette": false }
    ],
    "panels": [{ "id": "${id}.view", "title": "Hello" }]
  }
}
`;

const indexTs = (id: string): string => `import {
  defineExtension,
  defineExtensionPanel,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';
import type { ExtensionPanels } from '@dolphy-app/extension-sdk';
import { usePanel } from '@dolphy-app/extension-sdk/client';
import { computed, defineComponent, h, ref } from 'vue';

// extension code: \`host\` runs in the extension process of the app
// the ids come from extension.json: a misspelt id or a declared id without a
// handler fails \`pnpm typecheck\`
export const host = defineExtension({
  commands: {
    // palette command: shows a notification
    '${id}.hello': (args) => {
      const name = typeof args === 'string' ? args : 'world';
      return notify(\`Hello, \${name}!\`);
    },
    // palette command: opens the panel with properties
    '${id}.open': () => openPanel('${id}.view', { name: 'Dolphy' }),
    // hidden from the palette (palette: false): the panel asks for data
    '${id}.data': () => ({ message: 'Hello from ${id}' }),
  },
});

// the panel is a Vue component the app draws in its own window; \`usePanel()\`
// gives it the properties it was opened with and \`call\` for the commands above
const HelloPanel = defineComponent({
  setup() {
    const panel = usePanel();
    const message = ref('');
    // the app opens the panel again with new properties: \`panel.props\` is
    // reactive, the title follows it
    const name = computed(() => {
      const { props } = panel;
      return typeof props === 'object' && props !== null && 'name' in props
        ? String(props.name)
        : 'world';
    });
    void panel.call('${id}.data').then((data) => {
      message.value = (data as { message: string }).message;
    });
    return () =>
      h('div', [h('h2', \`Hello, \${name.value}!\`), h('p', message.value)]);
  },
});

export const panels = {
  '${id}.view': defineExtensionPanel(HelloPanel),
} satisfies ExtensionPanels;
`;

const indexTestTs = (id: string): string => `// @vitest-environment happy-dom
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-sdk';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-sdk';
import { loadCommands } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, shallowReactive } from 'vue';
import { host, panels } from '../src/index.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

const load = async () => {
  const commands = await loadCommands(host, {
    declaredCommands: ['${id}.hello', '${id}.open', '${id}.data'],
    declaredPanels: ['${id}.view'],
  });
  disposables.push(commands);
  return commands;
};

describe('${id}: commands', () => {
  it('hello greets the name from the arguments, "world" without them', async () => {
    const commands = await load();
    expect(await commands.run('${id}.hello', 'Ada')).toEqual({
      kind: 'notify',
      text: 'Hello, Ada!',
    });
    expect(await commands.run('${id}.hello')).toEqual({
      kind: 'notify',
      text: 'Hello, world!',
    });
  });

  it('open asks the app to open the panel with properties', async () => {
    const commands = await load();
    expect(await commands.run('${id}.open')).toEqual({
      kind: 'openPanel',
      panelId: '${id}.view',
      props: { name: 'Dolphy' },
    });
  });

  it('data returns what the panel shows', async () => {
    const commands = await load();
    expect(await commands.run('${id}.data')).toEqual({
      kind: 'data',
      value: { message: 'Hello from ${id}' },
    });
  });
});

// draws the panel the way the app does: the handle is provided to the component
const mountPanel = async (
  props: JsonValue | undefined,
  call: PanelHandle['call'],
) => {
  const handle = shallowReactive({
    panelId: '${id}.view',
    props,
    context: { courseId: null },
    call,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render: () => h(panels['${id}.view']) });
  app.provide(PANEL_HANDLE_KEY, handle);
  app.mount(host);
  disposables.push({
    dispose: () => {
      app.unmount();
      host.remove();
    },
  });
  // the panel asks a command: wait for the reply, then for the redraw
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  };
  await settle();
  return {
    host,
    reopen: async (next: JsonValue) => {
      handle.props = next;
      await settle();
    },
  };
};

describe('${id}: panel', () => {
  it('shows the data command reply and follows new properties', async () => {
    const calls: string[] = [];
    const panel = await mountPanel({ name: 'Ada' }, async (commandId) => {
      calls.push(commandId);
      return { message: 'Hello from the test' };
    });
    expect(panel.host.querySelector('h2')?.textContent).toBe('Hello, Ada!');
    expect(panel.host.querySelector('p')?.textContent).toBe(
      'Hello from the test',
    );
    expect(calls).toEqual(['${id}.data']);

    await panel.reopen({ name: 'Grace' });
    expect(panel.host.querySelector('h2')?.textContent).toBe('Hello, Grace!');
  });

  it('greets the world when it is opened without properties', async () => {
    const panel = await mountPanel(undefined, async () => ({ message: 'x' }));
    expect(panel.host.querySelector('h2')?.textContent).toBe('Hello, world!');
  });
});
`;

export const commandPanel: TemplateModule = {
  summary: [
    'A Dolphy extension: two commands in the command palette (Ctrl/⌘+K), a hidden',
    'data command and a panel — a page of the extension inside the app.',
  ],
  layout: [
    '- `extension.json` — the manifest (commands and the panel are declared in it);',
    '- `src/index.ts` — all the extension code: `host` (`defineExtension`, the',
    '  command handlers) and `panels` (`defineExtensionPanel`: a Vue component',
    '  the app draws); the build splits it into `main.mjs` and `panel.mjs`;',
    ...idsBullet,
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
