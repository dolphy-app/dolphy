# Recipe: hooks before a session and a batch

Step into the learning loop. A `before` hook runs before the engine does
something and may change its input or cancel it. This recipe reorders the
exercises of a session so that reviews come before new material and the most
forgotten come first, and refuses to
start a session in the small hours. There is no template for it; start from
`blank` and replace the files below, which are checked as a whole project. See
[quick-start.md](quick-start.md) for the commands. Events, which only observe,
are in [recipe-event-storage.md](recipe-event-storage.md).

## The manifest

File `extension.json` (hooks):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Reviews first",
  "description": "Puts reviews before new exercises and keeps sessions out of the small hours.",
  "author": "your-github-login",
  "tags": ["learning"]
}
```

Nothing about hooks is in the manifest: `server.before` is the registration.

## The code

File `src/index.ts` (hooks):

```ts
import { defineServer } from '@dolphy-app/extension-sdk';

const REVIEW_FIRST = { review: 0, remediation: 1, new: 2 } as const;

export const server = defineServer((s) => {
  // may only cancel: throw to stop the session from starting
  s.before('session.start', ({ now }) => {
    if (new Date(now).getHours() < 6) {
      throw new Error('Sessions are closed until six in the morning');
    }
  });

  // gets the batch the engine built and returns the one to use
  // reviews before new material, the most forgotten first within a group
  s.before('practice.batch', ({ exerciseIds, reasons, memory }) => {
    const items = exerciseIds
      .map((id, index) => ({
        id,
        reason: reasons[index] ?? 'new',
        // no attempts yet: nothing to forget
        retrievability: memory[index]?.retrievability ?? 1,
      }))
      .sort(
        (a, b) =>
          REVIEW_FIRST[a.reason] - REVIEW_FIRST[b.reason] ||
          a.retrievability - b.retrievability,
      );
    return {
      exerciseIds: items.map(({ id }) => id),
      reasons: items.map(({ reason }) => reason),
    };
  });
});
```

- `server.before(name, handler)` registers a hook. The names are a closed list:
  `session.start` and `practice.batch`; another name fails the registration.
  One handler per name; the call returns a `Disposable`.
- `session.start` gets `{ now }` (epoch milliseconds) and returns nothing. The
  only way to act is to throw: the session is not created and the learner sees
  the message of your error.
- `practice.batch` gets `{ sessionId, exerciseIds, reasons, memory, source }`
  (`sessionId` is `null` while the session does not exist yet, as in the daily
  plan before it starts).
  `reasons[i]` (`review`, `new` or `remediation`) belongs to `exerciseIds[i]`;
  `source` is `batch` for `practice.getBatch` and `plan` for the daily plan the
  window builds a session from. `memory[i]` is what the engine remembers of
  `exerciseIds[i]`, read-only: `retrievability` (0..1 chance to recall now),
  `lastAttemptAt` (epoch milliseconds), `attempts`, and the FSRS `stability`
  (days) and `difficulty`. An exercise with no attempts has `attempts: 0` and
  `null` in the other fields. Return `{ exerciseIds, reasons }` of the same
  length. You may reorder, drop and add exercises; every id must exist in the
  library, at most 500 ids.
- Extensions with a hook run one after another in the order of their ids; each
  gets the result of the previous one. A handler has 30 seconds.
- An error, a timeout or an answer the engine rejects (a missing exercise,
  unequal lengths, too many ids) cancels the whole operation: no session, no
  batch, nothing written to the journal. The caller gets the engine error
  `EXTENSION_HOOK_FAILED` with the extension id and your message, and the window
  shows it like any other failure to start a session.

## The test

File `test/index.test.ts` (hooks):

```ts
import { createTestServer } from '@dolphy-app/extension-sdk/testing';
import { expect, it } from 'vitest';
import { server } from '../src/index.ts';

const start = () => createTestServer(server, { extensionId: 'acme.hello' });

it('puts reviews before new exercises', async () => {
  const running = await start();
  const batch = await running.hook('practice.batch', {
    sessionId: 's1',
    exerciseIds: ['c::l::a', 'c::l::b', 'c::l::c'],
    reasons: ['new', 'review', 'remediation'],
    memory: [
      { retrievability: null, lastAttemptAt: null, attempts: 0, stability: null, difficulty: null },
      { retrievability: 0.8, lastAttemptAt: 1_000, attempts: 3, stability: 9, difficulty: 4 },
      { retrievability: 0.3, lastAttemptAt: 2_000, attempts: 1, stability: 2, difficulty: 6 },
    ],
    source: 'batch',
  });
  expect(batch).toEqual({
    exerciseIds: ['c::l::b', 'c::l::c', 'c::l::a'],
    reasons: ['review', 'remediation', 'new'],
  });
  await running.dispose();
});

it('puts the most forgotten exercises first within a group', async () => {
  const running = await start();
  const batch = await running.hook('practice.batch', {
    sessionId: 's1',
    exerciseIds: ['c::l::a', 'c::l::b', 'c::l::c'],
    reasons: ['new', 'review', 'review'],
    memory: [
      { retrievability: null, lastAttemptAt: null, attempts: 0, stability: null, difficulty: null },
      { retrievability: 0.8, lastAttemptAt: 1_000, attempts: 3, stability: 9, difficulty: 4 },
      { retrievability: 0.3, lastAttemptAt: 2_000, attempts: 1, stability: 2, difficulty: 6 },
    ],
    source: 'batch',
  });
  expect(batch.exerciseIds).toEqual(['c::l::c', 'c::l::b', 'c::l::a']);
  expect(batch.reasons).toEqual(['review', 'review', 'new']);
  await running.dispose();
});

it('refuses to start a session in the small hours', async () => {
  const running = await start();
  const night = new Date(2026, 9, 7, 3).getTime();
  await expect(running.hook('session.start', { now: night })).rejects.toThrow(
    'Sessions are closed until six in the morning',
  );
  const morning = new Date(2026, 9, 7, 9).getTime();
  await expect(
    running.hook('session.start', { now: morning }),
  ).resolves.toBeUndefined();
  await running.dispose();
});
```
