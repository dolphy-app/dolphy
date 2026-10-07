import { INITIAL_VERSION } from './common.ts';
import type { TemplateModule } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Hello panel",
  "description": "Palette commands that greet the learner and open a small panel.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
`;

const indexTs = (): string => `export { client } from './client.ts';
export { server } from './server.ts';
`;

export const serverTs = (
  id: string,
): string => `import { defineServer, notify, openPanel } from '@dolphy-app/extension-sdk';

// runs in the extension host: every call registers a contribution
export const server = defineServer((s) => {
  // palette command: shows a notification
  s.registerCommand({
    id: '${id}.hello',
    title: { en: 'Say hello', ru: 'Поздороваться' },
    category: 'Hello',
    run: (args) => {
      const name = typeof args === 'string' ? args : 'world';
      return notify(\`Hello, \${name}!\`);
    },
  });

  // palette command: opens the panel (registered by the client) with properties
  s.registerCommand({
    id: '${id}.open',
    title: { en: 'Open the hello panel', ru: 'Открыть панель' },
    category: 'Hello',
    run: () => openPanel('${id}.view', { name: 'Dolphy' }),
  });

  // hidden from the palette (palette: false): the panel asks for data
  s.registerCommand({
    id: '${id}.data',
    title: 'Hello panel data',
    palette: false,
    run: () => ({ message: 'Hello from ${id}' }),
  });
});
`;

const clientTs = (
  id: string,
): string => `import { defineClient } from '@dolphy-app/extension-sdk';
import StatusPanel from './StatusPanel.vue';

// runs in the app window: the panel is a Vue component the app draws
export const client = defineClient((c) => {
  c.addPanel({
    id: '${id}.view',
    title: { en: 'Hello', ru: 'Привет' },
    component: StatusPanel,
  });
});
`;

const statusPanelVue = (id: string): string => `<script setup lang="ts">
import { usePanel } from '@dolphy-app/extension-sdk/client';
import { computed, ref } from 'vue';

// \`usePanel()\` gives the panel the properties it was opened with and \`call\`
// for the commands of the extension
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

const load = async () => {
  const data = await panel.call('${id}.data');
  message.value = (data as { message: string }).message;
};
void load();
</script>

<template>
  <section class="status-panel">
    <h2>Hello, {{ name }}!</h2>
    <p>{{ message }}</p>
    <v-btn color="primary" @click="load">Reload</v-btn>
  </section>
</template>

<style scoped>
.status-panel {
  padding: 16px;
}
</style>
`;

const envDts = (): string => `declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<object, object, unknown>;
  export default component;
}
`;

const vitestConfigTs = (): string => `import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({ plugins: [vue()] });
`;

/** The tests of the server part: the same for every template with these commands. */
export const serverTestsTs = (
  id: string,
): string => `const start = async () => {
  const running = await createTestServer(server, { extensionId: '${id}' });
  disposables.push(running);
  return running;
};

describe('${id}: server', () => {
  it('hello greets the name from the arguments, "world" without them', async () => {
    const running = await start();
    expect(await running.commands.run('${id}.hello', 'Ada')).toEqual({
      kind: 'notify',
      text: 'Hello, Ada!',
    });
    expect(await running.commands.run('${id}.hello')).toEqual({
      kind: 'notify',
      text: 'Hello, world!',
    });
  });

  it('open asks the app to open the panel with properties', async () => {
    const running = await start();
    expect(await running.commands.run('${id}.open')).toEqual({
      kind: 'openPanel',
      panelId: '${id}.view',
      props: { name: 'Dolphy' },
    });
  });

  it('data returns what the panel shows and stays out of the palette', async () => {
    const running = await start();
    expect(await running.commands.run('${id}.data')).toEqual({
      kind: 'data',
      value: { message: 'Hello from ${id}' },
    });
    const hidden = running.registration.commands.find(
      (command) => command.id === '${id}.data',
    );
    expect(hidden?.palette).toBe(false);
  });
});`;

const indexTestTs = (id: string): string => `// @vitest-environment happy-dom
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-sdk';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowReactive } from 'vue';
import { client, server } from '../src/index.ts';
import StatusPanel from '../src/StatusPanel.vue';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

${serverTestsTs(id)}

describe('${id}: client', () => {
  it('adds the panel that the open command points to', async () => {
    const running = await createTestClient(client, { extensionId: '${id}' });
    disposables.push(running);
    expect(running.panels.map((panel) => panel.id)).toEqual(['${id}.view']);
    expect(running.panels[0]?.component).toBe(StatusPanel);
  });
});

// the app draws \`<v-btn>\` with its Vuetify; the test gives the panel a plain button
const VBtn = defineComponent({
  setup: (_props, { slots }) => () => h('button', slots['default']?.()),
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
  const app = createApp({ render: () => h(StatusPanel) });
  app.component('v-btn', VBtn);
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

  it('asks the data command again when the button is pressed', async () => {
    const calls: string[] = [];
    const panel = await mountPanel(undefined, async (commandId) => {
      calls.push(commandId);
      return { message: 'x' };
    });
    panel.host.querySelector('button')?.click();
    await panel.reopen({});
    expect(calls).toEqual(['${id}.data', '${id}.data']);
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
    '- `extension.json` — the manifest: identity only, the build adds `main` and',
    '  `client`;',
    '- `src/server.ts` — `server` (`defineServer`): the command handlers; the',
    '  build writes it to `main.mjs`;',
    '- `src/client.ts` — `client` (`defineClient`): registers the panel with',
    '  `addPanel`; `src/StatusPanel.vue` is the single-file Vue component the',
    '  app draws; the build writes them to `client.mjs`;',
    '- `src/env.d.ts` — tells `tsc` the type of a `.vue` import;',
    '- `vitest.config.ts` — `@vitejs/plugin-vue`, so a test can import `.vue`;',
    '- `src/index.ts` — re-exports `server` and `client`;',
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(),
    'src/server.ts': serverTs(id),
    'src/client.ts': clientTs(id),
    'src/StatusPanel.vue': statusPanelVue(id),
    'src/env.d.ts': envDts(),
    'vitest.config.ts': vitestConfigTs(),
    'test/index.test.ts': indexTestTs(id),
  }),
  devDependencies: { '@vitejs/plugin-vue': '^6.0.7' },
};
