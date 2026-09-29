import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCryptoRng,
  createJsonLogger,
  createUuidv7Generator,
  nodeDefaults,
} from '../../src/node/defaults.ts';
import { useTmpDirs } from '../helpers/tmp.ts';

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tmp = useTmpDirs();

describe('createUuidv7Generator', () => {
  it('produces v7/variant-10 ids carrying the timestamp', () => {
    const ms = 0x0123456789ab;
    const id = createUuidv7Generator({ clock: { now: () => ms } }).next();
    expect(id).toMatch(UUID_V7);
    expect(id.replace('-', '').slice(0, 12)).toBe('0123456789ab');
  });

  it('is lexicographically monotonic under a frozen clock', () => {
    const generator = createUuidv7Generator({
      clock: { now: () => 1_700_000_000_000 },
    });
    const ids = Array.from({ length: 20_000 }, () => generator.next());
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never goes back when the clock does', () => {
    let now = 5000;
    const generator = createUuidv7Generator({ clock: { now: () => now } });
    const first = generator.next();
    now = 4000;
    const second = generator.next();
    expect(second > first).toBe(true);
  });

  it('orders ids by time across milliseconds', () => {
    let now = 1000;
    const generator = createUuidv7Generator({ clock: { now: () => now } });
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      now += i % 3;
      ids.push(generator.next());
    }
    expect(ids).toEqual([...ids].sort());
  });
});

describe('createCryptoRng', () => {
  it('yields floats in [0, 1)', () => {
    const rng = createCryptoRng();
    for (let i = 0; i < 1000; i++) {
      const value = rng.random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('createJsonLogger', () => {
  const make = (env: Record<string, string> = {}) => {
    const lines: string[] = [];
    const logger = createJsonLogger(
      { write: (chunk) => lines.push(chunk) },
      { clock: { now: () => 42 }, env },
    );
    return { lines, logger };
  };

  it('writes one JSON line and serializes errors', () => {
    const { lines, logger } = make();
    logger.warn({ error: new TypeError('boom'), n: 1 }, 'failed');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith('\n')).toBe(true);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      level: 'warn',
      time: 42,
      msg: 'failed',
      n: 1,
      error: { name: 'TypeError', message: 'boom' },
    });
    expect(typeof record.error.stack).toBe('string');
  });

  it('omits msg when absent and accepts a bare Error', () => {
    const { lines, logger } = make();
    logger.error(new Error('x'));
    const record = JSON.parse(lines[0]!);
    expect(record).not.toHaveProperty('msg');
    expect(record.error.message).toBe('x');
  });

  it('hides debug unless ENGINE_LOG_LEVEL=debug', () => {
    const quiet = make();
    quiet.logger.debug({}, 'a');
    expect(quiet.lines).toEqual([]);
    const loud = make({ ENGINE_LOG_LEVEL: 'debug' });
    loud.logger.debug({}, 'a');
    expect(loud.lines).toHaveLength(1);
  });
});

describe('nodeDefaults', () => {
  it('assembles a working set', async () => {
    const root = await tmp.make();
    const libraryRoot = join(root, 'library');
    const dataDir = join(root, 'data');
    await mkdir(libraryRoot);
    await mkdir(dataDir);
    const deps = nodeDefaults({ libraryRoot, dataDir });
    expect(deps.ids.next()).toMatch(UUID_V7);
    expect(Math.abs(deps.clock.now() - Date.now())).toBeLessThan(1000);
    expect(deps.rng.range(0, 1)).toBe(0);
    expect(await deps.folderSync!.load()).toBeNull();
    const preferences = await deps.settings.loadPreferences();
    expect(preferences).toBeTruthy();
    expect(deps.memoryModel).toBeTruthy();
  });
});
