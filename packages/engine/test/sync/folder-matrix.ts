import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeClock, createSeededRng } from '@dolphy-app/testkit';
import type { FakeClock } from '@dolphy-app/testkit';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/domain/journal.ts';
import type { FolderSync } from '../../src/node/index.ts';
import { compareEntries, sha256Hex } from '../../src/sync/index.ts';
import type { Head } from '../../src/sync/index.ts';
import { createDevice } from './devices.ts';
import type { Device, StoreFactory } from './devices.ts';
import { oracleState, setOf, stateOf } from './oracle.ts';

const SEED = 20_260_929;
const CHILD = join(import.meta.dirname, 'sync-child.ts');

export interface FolderSubject {
  name: string;
  create: StoreFactory;
  /** Прогонов сходимости: 150 в полном режиме. */
  convergenceRuns: number;
}

interface Peer extends Device {
  fs: FolderSync;
}

const readHead = (dir: string, device: string): Head =>
  JSON.parse(readFileSync(join(dir, device, 'head.json'), 'utf8')) as Head;

const linesOf = (path: string) => readFileSync(path, 'utf8').trim().split('\n');

/** Матрица отказов `FolderSync` F-01…F-16 и сходимость (T-27…T-29, T-60). */
export const describeFolderMatrix = ({
  name,
  create,
  convergenceRuns,
}: FolderSubject) => {
  describe(`FolderSync fault matrix (${name})`, () => {
    let root: string;
    let counter = 0;
    const dirs = () => join(root, `t${counter++}`);

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'folder-sync-'));
    });
    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    const nodes: Peer[] = [];
    const node = async (
      dir: string,
      deviceId: string,
      options: { slot?: string; clock?: FakeClock; per?: number } = {},
    ): Promise<Peer> => {
      const { per = 5, slot = deviceId, clock } = options;
      const device = await createDevice(create, deviceId, {
        slot: `${slot}-${counter++}`,
        ...(clock && { clock }),
      });
      const made = Object.assign(device, { fs: device.folder(dir, per) });
      nodes.push(made);
      return made;
    };
    const teardown = async () => {
      for (const made of nodes.splice(0)) await made.store.close();
    };
    /** Каждый тест — своя папка и общие ручные часы. */
    const scenario = async (
      body: (context: { clock: FakeClock; dir: string }) => Promise<void>,
    ) => {
      try {
        await body({ clock: createFakeClock(), dir: dirs() });
      } finally {
        await teardown();
      }
    };
    const same = async (x: Peer, y: Peer) =>
      expect(await stateOf(x.store)).toEqual(await stateOf(y.store));

    it('publishes segments and head, re-export is a no-op, peers converge', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        const b = await node(dir, 'b', { clock });
        await a.many(12);
        await b.many(3, 'E2');
        expect(await a.fs.export()).toMatchObject({ segments: 3, entries: 12 });
        expect(readdirSync(join(dir, 'a')).sort()).toEqual([
          'head.json',
          'seg-1-5.jsonl',
          'seg-11-12.jsonl',
          'seg-6-10.jsonl',
        ]);
        const head = readHead(dir, 'a');
        expect(head.maxSeq).toBe(12);
        expect(
          head.segments.map((s) => [s.firstSeq, s.lastSeq, s.count]),
        ).toEqual([
          [1, 5, 5],
          [6, 10, 5],
          [11, 12, 2],
        ]);
        expect((await a.fs.export()).entries).toBe(0);
        await b.fs.export();
        expect(await b.fs.import()).toMatchObject({
          inserted: 12,
          duplicates: 0,
          rejected: 0,
          pending: 0,
        });
        expect(await a.fs.import()).toMatchObject({ inserted: 3, pending: 0 });
        await same(a, b);
        expect(await b.fs.import()).toMatchObject({
          inserted: 0,
          duplicates: 0,
        });
        expect(b.store.vector()).toEqual({ a: 12, b: 3 });
      }));

    it('F-01 segment before head: ignored, imported when head lands (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const source = dirs();
        const a = await node(source, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        mkdirSync(join(dir, 'a'), { recursive: true });
        copyFileSync(
          join(source, 'a', 'seg-1-5.jsonl'),
          join(dir, 'a', 'seg-1-5.jsonl'),
        );
        expect(await b.fs.import()).toMatchObject({
          inserted: 0,
          pending: 0,
          headErrors: [],
        });
        copyFileSync(
          join(source, 'a', 'head.json'),
          join(dir, 'a', 'head.json'),
        );
        expect(await b.fs.import()).toMatchObject({ inserted: 5, pending: 0 });
      }));

    it('F-02 head before segment: pending, imported when the segment lands (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const source = dirs();
        const a = await node(source, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        mkdirSync(join(dir, 'a'), { recursive: true });
        copyFileSync(
          join(source, 'a', 'head.json'),
          join(dir, 'a', 'head.json'),
        );
        const first = await b.fs.import();
        expect(first).toMatchObject({ inserted: 0, pending: 1 });
        expect(first.pendingSegments[0]).toContain('file not present');
        copyFileSync(
          join(source, 'a', 'seg-1-5.jsonl'),
          join(dir, 'a', 'seg-1-5.jsonl'),
        );
        expect(await b.fs.import()).toMatchObject({ inserted: 5, pending: 0 });
      }));

    it('F-03 truncated segment (0 B, 1 B, half, all but 1 B): sha256 mismatch → pending (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        const path = join(dir, 'a', 'seg-1-5.jsonl');
        const full = readFileSync(path);
        const b = await node(dir, 'b', { clock });
        for (const cut of [
          0,
          1,
          Math.floor(full.length / 2),
          full.length - 1,
        ]) {
          writeFileSync(path, full.subarray(0, cut));
          expect(await b.fs.import()).toMatchObject({
            inserted: 0,
            pending: 1,
            rejected: 0,
          });
        }
        expect(b.store.entryCount()).toBe(0);
        writeFileSync(path, full);
        expect(await b.fs.import()).toMatchObject({ inserted: 5, pending: 0 });
      }));

    it('F-04 truncated, empty or garbage head.json: device skipped this round (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        const path = join(dir, 'a', 'head.json');
        const good = readFileSync(path);
        const b = await node(dir, 'b', { clock });
        const broken = [
          Buffer.alloc(0),
          good.subarray(0, 20),
          Buffer.from('{"deviceId":"zzz"}'),
        ];
        for (const bad of broken) {
          writeFileSync(path, bad);
          const report = await b.fs.import();
          expect(report.inserted).toBe(0);
          expect(report.headErrors).toHaveLength(1);
        }
        writeFileSync(path, good);
        expect((await b.fs.import()).inserted).toBe(5);
      }));

    const corruptSegment = (
      dir: string,
      edit: (lines: string[]) => string[],
    ) => {
      const path = join(dir, 'a', 'seg-1-5.jsonl');
      const bytes = Buffer.from(`${edit(linesOf(path)).join('\n')}\n`);
      writeFileSync(path, bytes);
      const head = readHead(dir, 'a');
      head.segments[0]!.sha256 = sha256Hex(bytes);
      writeFileSync(join(dir, 'a', 'head.json'), JSON.stringify(head));
    };

    it('F-05 valid sha256 but a bad line or foreign deviceId: whole segment rejected once (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        corruptSegment(dir, (lines) =>
          lines.map((line, i) =>
            i === 2 ? JSON.stringify({ ...JSON.parse(line), grade: 9 }) : line,
          ),
        );
        const b = await node(dir, 'b', { clock });
        const first = await b.fs.import();
        expect(first.corruptSegments).toHaveLength(1);
        expect(first.corruptSegments[0]).toContain('schema: bad grade');
        expect(first).toMatchObject({ inserted: 0, rejected: 5 });
        const second = await b.fs.import();
        expect(second.corruptSegments).toEqual([]);
        expect(b.store.entryCount()).toBe(0);

        const dirForeign = dirs();
        const c = await node(dirForeign, 'a', { clock, slot: 'c' });
        await c.many(5);
        await c.fs.export();
        corruptSegment(dirForeign, (lines) =>
          lines.map((line, i) =>
            i === 1
              ? JSON.stringify({ ...JSON.parse(line), deviceId: 'evil' })
              : line,
          ),
        );
        const d = await node(dirForeign, 'd', { clock });
        expect((await d.fs.import()).corruptSegments[0]).toContain(
          'foreign deviceId evil',
        );
        expect(d.store.entryCount()).toBe(0);
      }));

    it('F-06 duplicates, conflicted copies and tmp files are ignored (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        copyFileSync(
          join(dir, 'a', 'seg-1-5.jsonl'),
          join(dir, 'a', 'seg-1-5 (conflicted copy).jsonl'),
        );
        writeFileSync(join(dir, 'a', 'seg-6-9.jsonl.tmp-1-abc'), 'garbage');
        copyFileSync(
          join(dir, 'a', 'head.json'),
          join(dir, 'a', 'head (conflicted copy).json'),
        );
        const b = await node(dir, 'b', { clock });
        expect(await b.fs.import()).toMatchObject({
          inserted: 5,
          duplicates: 0,
          rejected: 0,
          pending: 0,
        });
        expect(await b.fs.import()).toMatchObject({
          inserted: 0,
          duplicates: 0,
        });
        const replayed = linesOf(join(dir, 'a', 'seg-1-5.jsonl')).map(
          (line) => JSON.parse(line) as LogEntry,
        );
        expect(await b.replica.ingest(replayed)).toMatchObject({
          inserted: 0,
          duplicates: 5,
        });
      }));

    it('F-07 reordering: segments 6-12 before 1-5 wait, then apply in order (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const source = dirs();
        const a = await node(source, 'a', { clock });
        await a.many(12);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        mkdirSync(join(dir, 'a'), { recursive: true });
        copyFileSync(
          join(source, 'a', 'head.json'),
          join(dir, 'a', 'head.json'),
        );
        for (const file of ['seg-6-10.jsonl', 'seg-11-12.jsonl']) {
          copyFileSync(join(source, 'a', file), join(dir, 'a', file));
        }
        expect(await b.fs.import()).toMatchObject({ inserted: 0, pending: 3 });
        expect(b.store.vector()).toEqual({});
        copyFileSync(
          join(source, 'a', 'seg-1-5.jsonl'),
          join(dir, 'a', 'seg-1-5.jsonl'),
        );
        expect(await b.fs.import()).toMatchObject({ inserted: 12, pending: 0 });
      }));

    it('F-08 stale head after a newer one: no harm, late joiners see the older prefix (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        const oldHead = readFileSync(join(dir, 'a', 'head.json'));
        await a.many(5);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        await b.fs.import();
        expect(b.store.vector().a).toBe(10);
        writeFileSync(join(dir, 'a', 'head.json'), oldHead);
        expect(await b.fs.import()).toMatchObject({ inserted: 0, pending: 0 });
        expect(b.store.vector().a).toBe(10);
        const c = await node(dir, 'c', { clock });
        expect((await c.fs.import()).inserted).toBe(5);
      }));

    it('F-09 peer compaction: importers re-read the overlap, states equal (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(12);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        await b.fs.import();
        await a.many(3);
        await a.fs.export();
        const c = await node(dir, 'c', { clock });
        expect(await a.fs.compact(100)).toMatchObject({ before: 4, after: 1 });
        expect(readdirSync(join(dir, 'a')).sort()).toEqual([
          'head.json',
          'seg-1-15.jsonl',
        ]);
        expect(await b.fs.import()).toMatchObject({
          inserted: 3,
          duplicates: 12,
          pending: 0,
        });
        expect(await c.fs.import()).toMatchObject({ inserted: 15, pending: 0 });
        await same(b, c);
      }));

    it('F-10 segment edited in place after head: pending forever, nothing applied (T-27)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        appendFileSync(join(dir, 'a', 'seg-1-5.jsonl'), '\n');
        const b = await node(dir, 'b', { clock });
        expect(await b.fs.import()).toMatchObject({ inserted: 0, pending: 1 });
        expect(await b.fs.import()).toMatchObject({ inserted: 0, pending: 1 });
      }));

    it('F-11 restore from an old backup with the folder intact: catch-up, no seq reuse (T-29)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(40);
        await a.fs.export();
        const backup = (await a.all()).filter((e) => e.seq <= 25);
        await a.many(15);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        await b.fs.import();
        await b.many(2, 'E2');
        await b.fs.export();

        const a2 = await node(dir, 'a', { clock, slot: 'restored' });
        await a2.replica.ingest(backup);
        const check = await a2.fs.checkRestore();
        expect(check).toMatchObject({
          action: 'catch-up',
          localMax: 25,
          folderMax: 55,
        });
        a2.resetWriter();
        await a2.attempt();
        expect((await a2.fs.export()).entries).toBe(1);
        await b.fs.import();
        expect(b.store.vector().a).toBe(56);
        expect(await b.store.conflicts()).toEqual([]);
        await a2.fs.import();
        await same(a2, b);
      }));

    it('F-12 restore while a peer saw more: fork to a new deviceId (T-29)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(40);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        await b.fs.import();
        await b.fs.export();
        const backup = (await a.all()).filter((e) => e.seq <= 25);
        rmSync(join(dir, 'a'), { recursive: true });

        const a2 = await node(dir, 'a', { clock, slot: 'restored' });
        await a2.replica.ingest(backup);
        const check = await a2.fs.checkRestore();
        expect(check).toEqual({
          action: 'fork',
          localMax: 25,
          folderMax: 0,
          peerSeenMax: 40,
          newDeviceId: 'a-2',
        });
        expect(a2.store.deviceId).toBe('a-2');
        a2.resetWriter();
        await a2.attempt();
        expect((await a2.fs.export()).entries).toBe(1);
        await b.fs.import();
        expect(await b.store.conflicts()).toEqual([]);
        expect(b.store.vector()['a-2']).toBe(1);
        expect(b.store.vector().a).toBe(40);
      }));

    it('F-13 undetected restore: seq-two-ids is reported, real entries hidden not lost (T-29)', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(10);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        await b.fs.import();
        const backup = (await a.all()).filter((e) => e.seq <= 5);
        const a2 = await node(dir, 'a', { clock, slot: 'restored' });
        await a2.replica.ingest(backup);
        a2.resetWriter();
        rmSync(join(dir, 'a'), { recursive: true });
        await a2.many(5, 'E2');
        await a2.fs.export();

        const report = await b.fs.import();
        expect(report.rejected).toBeGreaterThan(0);
        expect(report.conflictIds).toHaveLength(5);
        const state = await stateOf(b.store);
        expect(state.conflicts.map((c) => c.reason)).toEqual(
          Array(5).fill('seq-two-ids'),
        );
        expect(state.conflicts.every((c) => c.members.length === 2)).toBe(true);
        expect(state.live).toHaveLength(5); // a#1..5; a#6..10 (both variants) hidden
        expect(await setOf(b.store)).toHaveLength(15);
        expect(state).toEqual(oracleState(await setOf(b.store)));
      }));

    it('F-14 cloned deviceId: the second export throws SYNC_DEVICE_ID_CLASH (T-29)', () =>
      scenario(async ({ clock, dir }) => {
        const x = await node(dir, 'a', { clock, slot: 'x' });
        const y = await node(dir, 'a', { clock, slot: 'y' });
        await x.many(4);
        await y.many(4, 'E2');
        await x.fs.export();
        await expect(y.fs.export()).rejects.toMatchObject({
          code: 'SYNC_DEVICE_ID_CLASH',
          retryable: false,
        });
      }));

    it('F-15 clone replaced the files: importer sees seq-two-ids ×4, 8 entries quarantined (T-29)', () =>
      scenario(async ({ clock, dir }) => {
        const dirY = dirs();
        const x = await node(dir, 'a', { clock, slot: 'x' });
        const y = await node(dirY, 'a', { clock, slot: 'y' });
        await x.many(4);
        await y.many(4, 'E2');
        await x.fs.export();
        await y.fs.export();
        const z = await node(dir, 'z', { clock });
        expect((await z.fs.import()).inserted).toBe(4);
        cpSync(join(dirY, 'a'), join(dir, 'a'), {
          recursive: true,
          force: true,
        });
        const report = await z.fs.import();
        expect(report.rejected).toBe(4);
        const state = await stateOf(z.store);
        expect(state.conflicts).toHaveLength(4);
        expect(state.live).toEqual([]);
        expect(await setOf(z.store)).toHaveLength(8);
      }));

    it('F-16 two OS processes write at once: no conflicts, identical state', async () => {
      for (const seed of [11, 22, 33]) {
        const dir = dirs();
        mkdirSync(dir, { recursive: true });
        const outputs = ['p1', 'p2'].map((id) => join(dir, `${id}.state`));
        await Promise.all(
          ['p1', 'p2'].map(
            (id, index) =>
              new Promise<void>((resolve, reject) => {
                const child = spawn(
                  process.execPath,
                  [
                    '--experimental-strip-types',
                    '--disable-warning=ExperimentalWarning',
                    CHILD,
                    dir,
                    id,
                    '40',
                    '9',
                    String(seed + index),
                    outputs[index]!,
                  ],
                  { stdio: 'inherit' },
                );
                child.on('exit', (code) =>
                  code === 0
                    ? resolve()
                    : reject(new Error(`${id} exit ${code}`)),
                );
              }),
          ),
        );
        const clock = createFakeClock(Date.now());
        const peers: Peer[] = [];
        try {
          for (const [index, id] of ['p1', 'p2'].entries()) {
            const peer = await node(dir, id, { clock, per: 7 });
            const own = JSON.parse(readFileSync(outputs[index]!, 'utf8'));
            await peer.replica.ingest(own as LogEntry[]);
            peers.push(peer);
          }
          for (const peer of peers) await peer.fs.import();
          const [p1, p2] = peers as [Peer, Peer];
          expect(p1.store.entryCount()).toBe(2 * 40 * 9);
          expect(p2.store.entryCount()).toBe(2 * 40 * 9);
          expect(await stateOf(p1.store)).toEqual(await stateOf(p2.store));
          expect(await p1.store.conflicts()).toEqual([]);
        } finally {
          await teardown();
        }
      }
    }, 60_000);

    it('T-60 the segment registry survives in the store: re-import applies nothing', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(12);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        expect(await b.fs.import()).toMatchObject({ inserted: 12 });
        expect((await b.store.segments()).map((s) => s.name).sort()).toEqual([
          'seg-1-5.jsonl',
          'seg-11-12.jsonl',
          'seg-6-10.jsonl',
        ]);
        // новый экземпляр FolderSync (как после рестарта): реестр берётся из хранилища
        const restarted = b.folder(dir, 5);
        expect(await restarted.import()).toMatchObject({
          inserted: 0,
          duplicates: 0,
          rejected: 0,
          pending: 0,
        });
      }));

    it('T-60 a covered segment with another sha256 becomes seq-two-ids, not a silent skip', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        await b.fs.import();
        const restarted = b.folder(dir, 5);
        // a переписан клоном: те же seq 1–5, другое содержимое
        rmSync(join(dir, 'a'), { recursive: true });
        const clone = await node(dir, 'a', { clock, slot: 'clone' });
        await clone.many(5, 'E2');
        await clone.fs.export();
        const report = await restarted.import();
        expect(report.rejected).toBe(5);
        expect((await stateOf(b.store)).conflicts).toHaveLength(5);
      }));

    it('T-58 a discarded conflict is not resurrected by re-importing the folder', () =>
      scenario(async ({ clock, dir }) => {
        const a = await node(dir, 'a', { clock });
        await a.many(5);
        await a.fs.export();
        const b = await node(dir, 'b', { clock });
        await b.fs.import();
        rmSync(join(dir, 'a'), { recursive: true });
        const clone = await node(dir, 'a', { clock, slot: 'clone' });
        await clone.many(5, 'E2');
        await clone.fs.export();
        await b.fs.import();
        const open = await b.replica.listConflicts();
        expect(open).toHaveLength(5);
        for (const conflict of open) {
          await b.replica.resolveConflict({
            conflictId: conflict.conflictId,
            keep: 'none',
          });
        }
        expect(await b.replica.listConflicts()).toEqual([]);
        expect(await b.fs.import()).toMatchObject({
          inserted: 0,
          rejected: 0,
          conflictIds: [],
        });
      }));

    it('T-28 four devices with random writes, exports, imports and truncations converge', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer(),
          fc.integer({ min: 4, max: 40 }),
          async (seed, steps) => {
            const rng = createSeededRng(seed);
            const dir = dirs();
            const clock = createFakeClock();
            const ids = ['a', 'b', 'c', 'd'];
            const group: Peer[] = [];
            try {
              for (const id of ids) {
                group.push(
                  await node(dir, id, {
                    clock,
                    per: 1 + Math.floor(rng.random() * 6),
                  }),
                );
              }
              const saved = new Map<string, Buffer>();
              for (let i = 0; i < steps; i++) {
                const target = group[Math.floor(rng.random() * 4)]!;
                const roll = rng.random();
                if (roll < 0.5) {
                  const count = 1 + Math.floor(rng.random() * 4);
                  for (let k = 0; k < count; k++) {
                    const kind = rng.random();
                    if (kind < 0.7) {
                      await target.attempt(
                        `E${1 + Math.floor(rng.random() * 4)}`,
                      );
                    } else if (kind < 0.85) {
                      await target.write({
                        kind: 'unit_flag',
                        unitId: 'E1',
                        flag: 'blacklist',
                        op: rng.random() < 0.5 ? 'set' : 'unset',
                      });
                    } else {
                      await target.write({
                        kind: 'progress_reset',
                        unitId: 'E1',
                      });
                    }
                  }
                  clock.advance(Math.floor(rng.random() * 3_000) - 1_000);
                } else if (roll < 0.7) {
                  await target.fs.export();
                } else if (roll < 0.9) {
                  await target.fs.import();
                } else {
                  const device = ids[Math.floor(rng.random() * 4)]!;
                  let files: string[] = [];
                  try {
                    files = readdirSync(join(dir, device));
                  } catch {
                    // устройство ещё ничего не публиковало
                  }
                  const segments = files.filter((f) => f.startsWith('seg-'));
                  if (segments.length > 0) {
                    const file = join(
                      dir,
                      device,
                      segments[Math.floor(rng.random() * segments.length)]!,
                    );
                    const bytes = readFileSync(file);
                    if (!saved.has(file)) saved.set(file, bytes);
                    writeFileSync(
                      file,
                      bytes.subarray(
                        0,
                        Math.floor(rng.random() * bytes.length),
                      ),
                    );
                  }
                }
              }
              for (const [file, bytes] of saved) writeFileSync(file, bytes);
              for (let round = 0; round < 3; round++) {
                for (const member of group) await member.fs.export();
                for (const member of group) await member.fs.import();
              }
              const written: LogEntry[] = [];
              for (const member of group) {
                written.push(
                  ...(await member.store.readDevice(member.deviceId, 1)),
                );
              }
              written.sort(compareEntries);
              const expected = oracleState(written);
              for (const member of group) {
                expect(await stateOf(member.store)).toEqual(expected);
              }
              expect(expected.conflicts).toEqual([]);
            } finally {
              await teardown();
            }
          },
        ),
        { seed: SEED, numRuns: convergenceRuns },
      );
    }, 300_000);
  });
};
