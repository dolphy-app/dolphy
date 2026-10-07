import { serverTestsTs, serverTs } from './command-panel.ts';
import { INITIAL_VERSION } from './common.ts';
import type { TemplateModule } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Hello React panel",
  "description": "Palette commands that greet the learner and open a panel drawn with React.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
`;

const configJson = (): string => `{
  "frameworks": ["react"]
}
`;

const indexTs = (): string => `export { client } from './client.tsx';
export { server } from './server.ts';
`;

const clientTsx = (
  id: string,
): string => `import { defineClient } from '@dolphy-app/extension-sdk';
import type { PanelHandle, PanelProps } from '@dolphy-app/extension-sdk';
import { reactComponent, usePanel } from '@dolphy-app/extension-sdk/react';
import { useEffect, useState } from 'react';

// \`reactComponent\` draws this component with React and gives it the props of
// the panel; \`usePanel()\` is the handle with \`call\` for the commands of the
// extension
const HelloPanel = ({ props }: PanelProps) => {
  const panel = usePanel();
  const [message, setMessage] = useState('');
  // the app opens the panel again with new properties: the component renders again
  const name =
    typeof props === 'object' && props !== null && 'name' in props
      ? String(props.name)
      : 'world';

  const load = async () => {
    const data = await panel.call('${id}.data');
    setMessage((data as { message: string }).message);
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <h2>Hello, {name}!</h2>
      <p>{message}</p>
      <button type="button" onClick={() => void load()}>
        Reload
      </button>
    </section>
  );
};

// runs in the app window: the panel is a \`Mountable\` the app draws into its own element
export const client = defineClient((c) => {
  c.addPanel({
    id: '${id}.view',
    title: { en: 'Hello', ru: 'Привет' },
    component: reactComponent<PanelProps, PanelHandle>(HelloPanel),
  });
});
`;

const indexTestTs = (id: string): string => `// @vitest-environment happy-dom
import { isMountable } from '@dolphy-app/extension-sdk';
import type { PanelHandle, PanelProps } from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
  mountForTest,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, server } from '../src/index.ts';

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
    expect(isMountable(running.panels[0]?.component)).toBe(true);
  });
});

// draws the panel the way the app does: into an element, on a context the test controls
const mountPanel = async (
  props: PanelProps['props'],
  call: PanelHandle['call'],
) => {
  const running = await createTestClient(client, { extensionId: '${id}' });
  disposables.push(running);
  const component = running.panels[0]?.component;
  if (!isMountable(component)) throw new Error('the panel is not a Mountable');
  const panelProps: PanelProps = {
    panelId: '${id}.view',
    props,
    context: { courseId: null },
  };
  const mounted = await mountForTest(component, {
    props: panelProps,
    handle: { ...panelProps, call },
  });
  disposables.push({ dispose: () => mounted.unmount() });
  return { mounted, panelProps };
};

describe('${id}: panel', () => {
  it('shows the data command reply and follows new properties', async () => {
    const calls: string[] = [];
    const { mounted, panelProps } = await mountPanel(
      { name: 'Ada' },
      async (commandId) => {
        calls.push(commandId);
        return { message: 'Hello from the test' };
      },
    );
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, Ada!');
    await vi.waitFor(() =>
      expect(mounted.el.querySelector('p')?.textContent).toBe(
        'Hello from the test',
      ),
    );
    expect(calls).toEqual(['${id}.data']);

    mounted.setProps({ ...panelProps, props: { name: 'Grace' } });
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, Grace!');
  });

  it('greets the world when it is opened without properties', async () => {
    const { mounted } = await mountPanel(undefined, async () => ({
      message: 'x',
    }));
    expect(mounted.el.querySelector('h2')?.textContent).toBe('Hello, world!');
  });

  it('asks the data command again when the button is pressed', async () => {
    const calls: string[] = [];
    const { mounted } = await mountPanel(undefined, async (commandId) => {
      calls.push(commandId);
      return { message: 'x' };
    });
    mounted.el.querySelector('button')?.click();
    await vi.waitFor(() => expect(calls).toEqual(['${id}.data', '${id}.data']));
  });
});
`;

export const reactPanel: TemplateModule = {
  summary: [
    'A Dolphy extension: two commands in the command palette (Ctrl/⌘+K), a hidden',
    'data command and a panel drawn with React instead of Vue.',
  ],
  layout: [
    '- `extension.json` — the manifest: identity only, the build adds `main` and',
    '  `client`;',
    '- `dolphy-ext.config.json` — `"frameworks": ["react"]` switches the React',
    '  build on (`.tsx` files, `react` and `react-dom` go into `client.mjs`);',
    '- `src/server.ts` — `server` (`defineServer`): the command handlers; the',
    '  build writes it to `main.mjs`;',
    '- `src/client.tsx` — `client` (`defineClient`): registers the panel with',
    '  `addPanel`; `reactComponent` from `@dolphy-app/extension-sdk/react` turns',
    '  the React component into what the app draws; the build writes it to',
    '  `client.mjs`;',
    '- `src/index.ts` — re-exports `server` and `client`;',
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`, `mountForTest`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'dolphy-ext.config.json': configJson(),
    'src/index.ts': indexTs(),
    'src/server.ts': serverTs(id),
    'src/client.tsx': clientTsx(id),
    'test/index.test.ts': indexTestTs(id),
  }),
  devDependencies: {
    '@types/react': '^19.3.0',
    '@types/react-dom': '^19.3.0',
    react: '^19.3.0',
    'react-dom': '^19.3.0',
  },
  compilerOptions: { jsx: '"react-jsx"' },
};
