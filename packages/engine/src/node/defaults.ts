import { getRandomValues } from 'node:crypto';
import { join } from 'node:path';
import type { EngineConfig, EpochMs } from '@dolphy-app/engine-contract';
import type { EngineDeps } from '../app/context.ts';
import { createRng, f64FromWords } from '../domain/rng.ts';
import type { Clock, IdGenerator, Logger, Rng } from '../ports/index.ts';
import { createTsFsrsMemoryModel } from '../scoring/memory-model.ts';
import { createNodeFsCourseSource } from './fs-course-source.ts';
import { createNodeFolderSyncPort } from './folder-sync-port.ts';
import { createFileLogReader } from './log-reader.ts';
import { createJsonSettingsStore } from './json-settings-store.ts';
import { createNodeSnapshotInstaller } from './snapshot-installer.ts';

export type NodeDefaults = Omit<
  EngineDeps,
  | 'eventStore'
  | 'exerciseTypes'
  | 'gradePolicies'
  | 'extensionCommands'
  | 'extensionRpc'
  | 'extensionTransfers'
  | 'extensionRegistry'
  | 'extensionPolicy'
  | 'extensionHealth'
  | 'extensionHostControl'
  | 'extensionInstaller'
  | 'extensionReloader'
  | 'openTraneSource'
  | 'repositoryStore'
  | 'extensionDataStore'
  | 'snapshotFetcher'
>;

export const createSystemClock = (): Clock => ({ now: () => Date.now() });

export type FillRandom = (bytes: Uint8Array) => void;

const fillCrypto: FillRandom = (bytes) => {
  getRandomValues(bytes);
};

export const createCryptoRng = (fill: FillRandom = fillCrypto): Rng => {
  const words = new Uint32Array(2);
  const bytes = new Uint8Array(words.buffer);
  return createRng(() => {
    fill(bytes);
    return f64FromWords(words[0] as number, words[1] as number);
  });
};

const RAND_A_MAX = 0xfff;
const MAX_MS = 2 ** 48 - 1;
const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

export interface Uuidv7Deps {
  clock?: Clock;
  fill?: FillRandom;
}

/**
 * uuidv7 (RFC 9562 §5.7): 48 бит мс, версия, 12 бит `rand_a`, вариант,
 * 62 бита `rand_b`. Внутри одной мс `rand_a` — растущий счётчик (метод 1);
 * при переполнении или откате часов время не идёт назад, а сдвигается на 1 мс.
 */
export const createUuidv7Generator = ({
  clock = createSystemClock(),
  fill = fillCrypto,
}: Uuidv7Deps = {}): IdGenerator => {
  let lastMs: EpochMs = -1;
  let counter = 0;
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);

  const next = () => {
    const now = clock.now();
    fill(bytes);
    const randA = ((bytes[6] as number) & 0x0f) * 256 + (bytes[7] as number);
    if (now > lastMs) {
      lastMs = now;
      // старший бит счётчика сброшен: остаётся запас на инкременты в мс
      counter = randA & 0x7ff;
    } else if (counter < RAND_A_MAX) {
      counter++;
    } else {
      lastMs++;
      counter = randA & 0x7ff;
    }
    if (lastMs > MAX_MS) throw new RangeError(`Timestamp out of range`);
    view.setUint16(0, Math.floor(lastMs / 2 ** 32));
    view.setUint32(2, lastMs % 2 ** 32);
    view.setUint16(6, 0x7000 | counter);
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => HEX[byte] as string);
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10).join(''),
    ].join('-');
  };

  return { next };
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

export interface LogStream {
  write(chunk: string): unknown;
}

export interface JsonLoggerDeps {
  clock?: Clock;
  /** Минимальный уровень; по умолчанию `ENGINE_LOG_LEVEL` из `env`, иначе `info`. */
  level?: Level;
  env?: Readonly<Record<string, string | undefined>>;
}

const isLevel = (value: string | undefined): value is Level =>
  value !== undefined && Object.hasOwn(LEVELS, value);

const replacer = (_key: string, value: unknown) => {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return typeof value === 'bigint' ? value.toString() : value;
};

/** Одна JSON-строка на запись: `{level, time, msg?, ...fields}`. */
export const createJsonLogger = (
  stream: LogStream = process.stderr,
  {
    clock = createSystemClock(),
    env = process.env,
    level: minLevel = isLevel(env.ENGINE_LOG_LEVEL)
      ? env.ENGINE_LOG_LEVEL
      : 'info',
  }: JsonLoggerDeps = {},
): Logger => {
  const log = (level: Level) => (fields: object, message?: string) => {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const extra = fields instanceof Error ? { error: fields } : fields;
    const record = { level, time: clock.now(), msg: message, ...extra };
    stream.write(`${JSON.stringify(record, replacer)}\n`);
  };
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
};

export const nodeDefaults = (config: EngineConfig): NodeDefaults => {
  const clock = createSystemClock();
  const logger = createJsonLogger(process.stderr, { clock });
  return {
    clock,
    rng: createCryptoRng(),
    ids: createUuidv7Generator({ clock }),
    logger,
    courseSource: createNodeFsCourseSource(config.libraryRoot),
    settings: createJsonSettingsStore({
      dir: join(config.dataDir, 'settings'),
      logger,
    }),
    memoryModel: createTsFsrsMemoryModel(),
    ...(config.logsDir !== undefined && {
      logReader: createFileLogReader(config.logsDir),
    }),
    folderSync: createNodeFolderSyncPort(config, { logger }),
    snapshotInstaller: createNodeSnapshotInstaller({
      libraryRoot: config.libraryRoot,
      dataDir: config.dataDir,
    }),
  };
};
