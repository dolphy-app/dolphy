import { INITIAL_VERSION, idsBullet } from './common.ts';
import type { TemplateModule } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Day streak",
  "description": "Counts the days in a row with a closed attempt and shows the streak.",
  "author": "your-github-login",
  "permissions": ["learning.events"],
  "tags": ["learning"],
  "contributes": {
    "events": [{ "event": "attempt.closed" }],
    "commands": [
      { "id": "${id}.show", "title": "Show the streak", "category": "Streak" },
      { "id": "${id}.data", "title": "Streak data", "palette": false }
    ],
    "panels": [{ "id": "${id}.view", "title": "Streak" }]
  }
}
`;

const indexTs = (id: string): string => `import {
  defineExtension,
  defineExtensionPanel,
  inActivate,
  notify,
  openPanel,
} from '@dolphy-app/extension-sdk';
import type { ExtensionPanels } from '@dolphy-app/extension-sdk';

// a \`type\`, not an \`interface\`: an interface has no index signature and is
// not JSON for \`ctx.storage\`
export type Streak = {
  days: number;
  last: string;
};

const KEY = 'streak';
const DAY_MS = 86_400_000;

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

// the streak grows when an attempt is closed the day after the last one;
// the same day changes nothing, a skipped day starts over
export const advance = (streak: Streak | undefined, at: number): Streak => {
  const day = dayOf(at);
  if (streak?.last === day) return streak;
  const continues =
    streak !== undefined && dayOf(Date.parse(streak.last) + DAY_MS) === day;
  return { days: continues ? streak.days + 1 : 1, last: day };
};

// every event and command declared in extension.json is listed here;
// \`inActivate\` means "registered in \`activate\`": the handlers need \`ctx\`
export const host = defineExtension({
  events: { 'attempt.closed': inActivate },
  commands: { '${id}.show': inActivate, '${id}.data': inActivate },
  activate(ctx) {
    // delivered asynchronously, once per recorded attempt
    ctx.events.on('attempt.closed', async ({ at, outcome }) => {
      if (outcome === 'gave-up') return;
      const streak = await ctx.storage.get<Streak>(KEY);
      await ctx.storage.set(KEY, advance(streak, at));
    });

    // data for the panel: hidden from the palette, the panel calls it
    ctx.commands.register(
      '${id}.data',
      async () => (await ctx.storage.get<Streak>(KEY)) ?? { days: 0, last: '' },
    );

    ctx.commands.register('${id}.show', async () => {
      const streak = await ctx.storage.get<Streak>(KEY);
      if (streak === undefined) {
        return notify('No streak yet: finish your first exercise.');
      }
      return openPanel('${id}.view', { days: streak.days });
    });
  },
});

// the panel runs in an isolated frame: no network, the only way out is \`ctx.call\`
export const panels = {
  '${id}.view': defineExtensionPanel({
    async mount(container, ctx) {
      const line = container.ownerDocument.createElement('p');
      container.append(line);
      const render = async () => {
        const streak = (await ctx.call('${id}.data')) as Streak;
        line.textContent =
          streak.days === 0
            ? 'No streak yet.'
            : \`Streak: \${streak.days} days, last day \${streak.last}\`;
      };
      // the command opens the panel again with new properties: redraw
      ctx.signal.addEventListener(
        'abort',
        ctx.onProps(() => void render()),
      );
      await render();
    },
  }),
} satisfies ExtensionPanels;
`;

const indexTestTs = (id: string): string => `// @vitest-environment happy-dom
import type { LearningEventPayloads } from '@dolphy-app/extension-api';
import {
  createMemoryStorage,
  loadCommands,
  loadEvents,
  loadPanel,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { host, panels } from '../src/index.ts';

const disposables: { dispose(): unknown }[] = [];
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((item) => item.dispose()));
});

type Attempt = LearningEventPayloads['attempt.closed'];

const attempt = (day: string, outcome: Attempt['outcome'] = 'passed'): Attempt => ({
  exerciseId: 'e',
  courseId: 'c',
  lessonId: 'l',
  grade: 4,
  outcome,
  source: 'runner',
  at: Date.parse(\`\${day}T12:00:00Z\`),
});

const load = async () => {
  const storage = createMemoryStorage();
  const events = await loadEvents(host, {
    storage,
    declared: ['attempt.closed'],
  });
  const commands = await loadCommands(host, {
    storage,
    declaredCommands: ['${id}.show', '${id}.data'],
    declaredPanels: ['${id}.view'],
  });
  disposables.push(events, commands);
  return { storage, events, commands };
};

describe('${id}: events and storage', () => {
  it('counts consecutive days, ignores a repeat on the same day', async () => {
    const { storage, events } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-02'));
    expect(await storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
  });

  it('a skipped day starts over; giving up leaves the streak alone', async () => {
    const { storage, events } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    await events.emit('attempt.closed', attempt('2026-10-02'));
    await events.emit('attempt.closed', attempt('2026-10-03', 'gave-up'));
    expect(await storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
    await events.emit('attempt.closed', attempt('2026-10-05'));
    expect(await storage.get('streak')).toEqual({
      days: 1,
      last: '2026-10-05',
    });
  });
});

describe('${id}: commands and panel', () => {
  it('without a streak the show command notifies, the data command returns zeros', async () => {
    const { commands } = await load();
    expect(await commands.run('${id}.show')).toMatchObject({ kind: 'notify' });
    expect(await commands.run('${id}.data')).toEqual({
      kind: 'data',
      value: { days: 0, last: '' },
    });
  });

  it('with a streak the show command opens the panel with the days', async () => {
    const { events, commands } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    expect(await commands.run('${id}.show')).toEqual({
      kind: 'openPanel',
      panelId: '${id}.view',
      props: { days: 1 },
    });
  });

  it('the panel shows what the data command returns', async () => {
    const { events, commands } = await load();
    await events.emit('attempt.closed', attempt('2026-10-01'));
    const panel = await loadPanel(panels, '${id}.view', {
      call: async (commandId) => {
        const result = await commands.run(commandId);
        return result.kind === 'data' ? result.value : undefined;
      },
    });
    disposables.push(panel);
    expect(panel.container.querySelector('p')?.textContent).toBe(
      'Streak: 1 days, last day 2026-10-01',
    );
  });
});
`;

export const events: TemplateModule = {
  summary: [
    'A Dolphy extension: a day streak. It listens to `attempt.closed`, keeps',
    'the streak in `ctx.storage`, and shows it with a command and a panel.',
    'It asks for the `learning.events` permission: without it no event arrives.',
  ],
  layout: [
    '- `extension.json` — the manifest (the event, the commands, the panel and',
    '  the `learning.events` permission are declared in it);',
    '- `src/index.ts` — all the extension code: `host` (`defineExtension`: the',
    '  event handler, the commands, `ctx.storage`) and `panels`',
    '  (`defineExtensionPanel`); the build splits it into `main.mjs` and',
    '  `panel.mjs`;',
    ...idsBullet,
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
