import { INITIAL_VERSION } from './common.ts';
import type { TemplateModule } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Hello command",
  "description": "A command-palette command that shows a notification.",
  "author": "your-github-login",
  "tags": ["productivity"]
}
`;

const indexTs = (
  id: string,
): string => `import { defineServer, notify } from '@dolphy-app/extension-sdk';

// runs in the extension host: every call registers a contribution
export const server = defineServer((s) => {
  s.registerCommand({
    id: '${id}.hello',
    title: { en: 'Say hello', ru: 'Поздороваться' },
    run: () => notify('Hello from ${id}!'),
  });
});
`;

const indexTestTs = (
  id: string,
): string => `import { createTestServer } from '@dolphy-app/extension-sdk/testing';
import { expect, it } from 'vitest';
import { server } from '../src/index.ts';

it('the hello command notifies', async () => {
  const running = await createTestServer(server, { extensionId: '${id}' });
  expect(await running.commands.run('${id}.hello')).toEqual({
    kind: 'notify',
    text: 'Hello from ${id}!',
  });
  await running.dispose();
});
`;

export const blank: TemplateModule = {
  summary: [
    'A Dolphy extension: the smallest project that does something, one command',
    'in the command palette (Ctrl/⌘+K) that shows a notification.',
  ],
  layout: [
    '- `extension.json` — the manifest: identity only, the build adds `main`;',
    '- `src/index.ts` — all the extension code: `server` (`defineServer`),',
    '  which registers the command; the build writes it to `main.mjs`;',
    '- `test/index.test.ts` — tests (`vitest`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
