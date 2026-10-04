import { INITIAL_VERSION } from './common.ts';
import type { TemplateModule } from './common.ts';
import { idsBullet } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Hello command",
  "description": "A command-palette command that shows a notification.",
  "author": "your-github-login",
  "tags": ["productivity"],
  "contributes": {
    "commands": [{ "id": "${id}.hello", "title": "Say hello" }]
  }
}
`;

const indexTs = (
  id: string,
): string => `import { defineExtension, notify } from '@dolphy-app/extension-sdk';

// extension code: runs in the extension process of the app
// the command id comes from extension.json: a misspelt id or a declared id
// without a handler fails \`pnpm typecheck\`
export const host = defineExtension({
  commands: {
    '${id}.hello': () => notify('Hello from ${id}!'),
  },
});
`;

const indexTestTs = (
  id: string,
): string => `import { loadCommands } from '@dolphy-app/extension-sdk/testing';
import { expect, it } from 'vitest';
import { host } from '../src/index.ts';

it('the hello command notifies', async () => {
  const commands = await loadCommands(host, {
    declaredCommands: ['${id}.hello'],
  });
  expect(await commands.run('${id}.hello')).toEqual({
    kind: 'notify',
    text: 'Hello from ${id}!',
  });
  await commands.dispose();
});
`;

export const blank: TemplateModule = {
  summary: [
    'A Dolphy extension: the smallest project that does something, one command',
    'in the command palette (Ctrl/⌘+K) that shows a notification.',
  ],
  layout: [
    '- `extension.json` — the manifest (the command is declared in it);',
    '- `src/index.ts` — all the extension code: `host` (`defineExtension`); the',
    '  build writes it to `main.mjs`;',
    ...idsBullet,
    '- `test/index.test.ts` — tests (`vitest`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
