import { INITIAL_VERSION } from './common.ts';
import type { TemplateModule } from './common.ts';

const manifestJson = (id: string): string => `{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "${id}",
  "version": "${INITIAL_VERSION}",
  "apiVersion": 1,
  "name": "Day streak",
  "description": "Counts the days in a row with a closed attempt and shows the streak.",
  "author": "your-github-login",
  "tags": ["learning"]
}
`;

const indexTs = (): string => `export { client } from './client.ts';
export { server } from './server.ts';
`;

const streakTs =
  (): string => `// a \`type\`, not an \`interface\`: an interface has no index signature and is
// not JSON for \`server.storage\`
export type Streak = {
  days: number;
  last: string;
};

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
`;

const serverTs = (
  id: string,
): string => `import { defineServer, notify, openPanel } from '@dolphy-app/extension-sdk';
import { advance } from './streak.ts';
import type { Streak } from './streak.ts';

const KEY = 'streak';

// runs in the extension host: every call registers a contribution
export const server = defineServer((s) => {
  // delivered asynchronously, once per recorded attempt
  s.on('attempt.closed', async ({ at, outcome }) => {
    if (outcome === 'gave-up') return;
    const streak = await s.storage.get<Streak>(KEY);
    await s.storage.set(KEY, advance(streak, at));
  });

  // data for the panel: hidden from the palette, the panel calls it
  s.registerCommand({
    id: '${id}.data',
    title: 'Streak data',
    palette: false,
    run: async () =>
      (await s.storage.get<Streak>(KEY)) ?? { days: 0, last: '' },
  });

  s.registerCommand({
    id: '${id}.show',
    title: { en: 'Show the streak', ru: 'Показать серию' },
    category: 'Streak',
    run: async () => {
      const streak = await s.storage.get<Streak>(KEY);
      if (streak === undefined) {
        return notify('No streak yet: finish your first exercise.');
      }
      return openPanel('${id}.view', { days: streak.days });
    },
  });
});
`;

const clientTs = (
  id: string,
): string => `import { defineClient } from '@dolphy-app/extension-sdk';
import { StreakPanel } from './streak-panel.ts';

// runs in the app window: the panel is a Vue component the app draws
export const client = defineClient((c) => {
  c.addPanel({
    id: '${id}.view',
    title: { en: 'Streak', ru: 'Серия' },
    component: StreakPanel,
  });
});
`;

const streakPanelTs = (
  id: string,
): string => `import { usePanel } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h, ref, watchEffect } from 'vue';
import type { Streak } from './streak.ts';

// the only way to the data is \`panel.call\` to the commands of the server
export const StreakPanel = defineComponent({
  setup() {
    const panel = usePanel();
    const text = ref('');
    // the command opens the panel again with new properties: ask again
    watchEffect(async () => {
      void panel.props;
      const streak = (await panel.call('${id}.data')) as Streak;
      text.value =
        streak.days === 0
          ? 'No streak yet.'
          : \`Streak: \${streak.days} days, last day \${streak.last}\`;
    });
    return () => h('p', text.value);
  },
});
`;

const indexTestTs = (id: string): string => `// @vitest-environment happy-dom
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-sdk';
import type {
  JsonValue,
  LearningEventPayloads,
  PanelHandle,
} from '@dolphy-app/extension-sdk';
import {
  createTestClient,
  createTestServer,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, shallowReactive } from 'vue';
import { client, server } from '../src/index.ts';
import { StreakPanel } from '../src/streak-panel.ts';

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

const start = async () => {
  const running = await createTestServer(server, { extensionId: '${id}' });
  disposables.push(running);
  return running;
};

// draws the panel the way the app does: the handle is provided to the component
const mountPanel = async (call: PanelHandle['call']) => {
  const handle = shallowReactive({
    panelId: '${id}.view',
    props: undefined as JsonValue | undefined,
    context: { courseId: null },
    call,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render: () => h(StreakPanel) });
  app.provide(PANEL_HANDLE_KEY, handle);
  app.mount(host);
  disposables.push({
    dispose: () => {
      app.unmount();
      host.remove();
    },
  });
  // the panel asks a command: wait for the reply, then for the redraw
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  return host;
};

describe('${id}: events and storage', () => {
  it('subscribes to attempt.closed', async () => {
    const running = await start();
    expect(running.registration.events).toEqual(['attempt.closed']);
  });

  it('counts consecutive days, ignores a repeat on the same day', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-02'));
    expect(await running.storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
  });

  it('a skipped day starts over; giving up leaves the streak alone', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    await running.events.emit('attempt.closed', attempt('2026-10-02'));
    await running.events.emit('attempt.closed', attempt('2026-10-03', 'gave-up'));
    expect(await running.storage.get('streak')).toEqual({
      days: 2,
      last: '2026-10-02',
    });
    await running.events.emit('attempt.closed', attempt('2026-10-05'));
    expect(await running.storage.get('streak')).toEqual({
      days: 1,
      last: '2026-10-05',
    });
  });
});

describe('${id}: commands and panel', () => {
  it('without a streak the show command notifies, the data command returns zeros', async () => {
    const running = await start();
    expect(await running.commands.run('${id}.show')).toMatchObject({
      kind: 'notify',
    });
    expect(await running.commands.run('${id}.data')).toEqual({
      kind: 'data',
      value: { days: 0, last: '' },
    });
  });

  it('with a streak the show command opens the panel with the days', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    expect(await running.commands.run('${id}.show')).toEqual({
      kind: 'openPanel',
      panelId: '${id}.view',
      props: { days: 1 },
    });
  });

  it('the client adds the panel the show command opens', async () => {
    const running = await createTestClient(client, { extensionId: '${id}' });
    disposables.push(running);
    expect(running.panels.map((panel) => panel.id)).toEqual(['${id}.view']);
  });

  it('the panel shows what the data command returns', async () => {
    const running = await start();
    await running.events.emit('attempt.closed', attempt('2026-10-01'));
    const panel = await mountPanel(async (commandId) => {
      const result = await running.commands.run(commandId);
      return result.kind === 'data' ? (result.value as JsonValue) : undefined;
    });
    expect(panel.querySelector('p')?.textContent).toBe(
      'Streak: 1 days, last day 2026-10-01',
    );
  });
});
`;

export const events: TemplateModule = {
  summary: [
    'A Dolphy extension: a day streak. It listens to `attempt.closed`, keeps',
    'the streak in `server.storage`, and shows it with a command and a panel.',
  ],
  layout: [
    '- `extension.json` — the manifest: identity only, the build adds `main` and',
    '  `client`;',
    '- `src/server.ts` — `server` (`defineServer`): the event handler, the',
    '  commands, `server.storage`; `src/streak.ts` is the streak arithmetic; the',
    '  build writes them to `main.mjs`;',
    '- `src/client.ts` — `client` (`defineClient`): registers the panel with',
    '  `addPanel`; `src/streak-panel.ts` is the Vue component the app draws; the',
    '  build writes them to `client.mjs`;',
    '- `src/index.ts` — re-exports `server` and `client`;',
    '- `test/index.test.ts` — tests (`vitest`, `happy-dom`).',
  ],
  files: (id) => ({
    'extension.json': manifestJson(id),
    'src/index.ts': indexTs(),
    'src/streak.ts': streakTs(),
    'src/server.ts': serverTs(id),
    'src/client.ts': clientTs(id),
    'src/streak-panel.ts': streakPanelTs(id),
    'test/index.test.ts': indexTestTs(id),
  }),
};
