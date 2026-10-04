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

// the panel runs in an isolated frame of the app window: no network, no
// window.dolphy; the only way out is \`ctx.call\` to the commands above
export const panels = {
  '${id}.view': defineExtensionPanel({
    async mount(container, ctx) {
      const doc = container.ownerDocument;
      const title = doc.createElement('h2');
      const line = doc.createElement('p');
      container.append(title, line);
      const name = (props: unknown): string =>
        typeof props === 'object' && props !== null && 'name' in props
          ? String(props.name)
          : 'world';
      title.textContent = \`Hello, \${name(ctx.props)}!\`;
      // the app opens the panel again with new properties: redraw the title
      ctx.signal.addEventListener(
        'abort',
        ctx.onProps((props) => {
          title.textContent = \`Hello, \${name(props)}!\`;
        }),
      );
      const data = (await ctx.call('${id}.data')) as { message: string };
      line.textContent = data.message;
    },
  }),
} satisfies ExtensionPanels;
`;

const indexTestTs = (id: string): string => `// @vitest-environment happy-dom
import {
  loadCommands,
  loadPanel,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('${id}: panel', () => {
  it('shows the data command reply and follows new properties', async () => {
    const panel = await loadPanel(panels, '${id}.view', {
      props: { name: 'Ada' },
      call: () => ({ message: 'Hello from the test' }),
    });
    disposables.push(panel);
    expect(panel.container.querySelector('h2')?.textContent).toBe('Hello, Ada!');
    expect(panel.container.querySelector('p')?.textContent).toBe(
      'Hello from the test',
    );
    expect(panel.calls).toEqual([{ commandId: '${id}.data', args: undefined }]);

    panel.setProps({ name: 'Grace' });
    expect(panel.container.querySelector('h2')?.textContent).toBe(
      'Hello, Grace!',
    );
  });

  it('stops listening for properties when the panel closes', async () => {
    const panel = await loadPanel(panels, '${id}.view', {
      call: () => ({ message: 'x' }),
    });
    const heading = panel.container.querySelector('h2');
    panel.dispose();
    expect(panel.aborted).toBe(true);
    panel.setProps({ name: 'Late' });
    expect(heading?.textContent).toBe('Hello, world!');
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
    '  command handlers) and `panels` (`defineExtensionPanel`); the build',
    '  splits it into `main.mjs` and `panel.mjs`;',
    ...idsBullet,
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
