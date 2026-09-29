# engine-ts: слой бизнес-логики внутри Electron-приложения (псевдокод)

Статус: проект v1, 2026-09-29; кода нет; псевдокод — ориентир для M0–M6, имена портов и контракт — из `engine-ts.md` и `engine-ts-api.md`. Типы в блоках намеренно неполные (`ExerciseManifest`, `LibraryHolder` и т. п. — только имена): блоки проверяются на синтаксис, а не на типы.
Связанные документы (в этом же каталоге): `engine-ts.md` (главный дизайн), `engine-ts-api.md` (контракт для UI), `engine-ts-testing.md` (тесты на vitest).
Пометки: **[ИЗМЕРЕНО]** — получено прогоном; **[ВЫВОД]** — наше умозаключение; **[ОЦЕНКА]** — расчёт, не замер; **[НЕ ПОДТВЕРЖДЕНО]** — не проверено.

Источники идей: LogRocket [«Advanced Electron.js architecture»](https://blog.logrocket.com/advanced-electron-js-architecture/), Habr [«Современная архитектура Electron приложений в 2021»](https://habr.com/ru/articles/578016/), dev.to [«The architecture of an Electron app ported to Web»](https://dev.to/lyricistant/the-architecture-of-an-electron-app-ported-to-web-1o5c) (Lyricistant). Что именно взято — §15. Стиль кода — скиллы `js-conventions`, `js-gof`, `error-handling`, `js-data-structures` (§3).

## 0. Решения в одной таблице

| Вопрос | Решение |
|---|---|
| Где живёт логика | В `utilityProcess` (хост движка), никогда в main и не в скрытом renderer (LogRocket: CPU-нагрузка в main замораживает приложение, в скрытом renderer деградирует) |
| Транспорт | Один `MessagePort` на окно: создаёт main (`MessageChannelMain`), UI получает порт через preload. `ipcMain` — только два канала: `engine:connect` и `platform:pickDirectory`. Синхронный IPC (`sendSync`) запрещён |
| Абстракция транспорта | Интерфейс `MessageEndpoint` (аналог `Delegate` из Lyricistant): клиент и диспетчер не знают про Electron. Адаптеры: `fromDomPort` (renderer), `fromNodePort` (хост), `createInProcessPair` (тесты и возможный веб) |
| Пакеты | К четырём пакетам `engine-ts.md` §0 добавляется пятый — `@lms/engine-rpc` (subpath `./client` без zod для renderer, `./host` с zod и диспетчером) |
| Стиль | Фабрики `createX(ctx)` и замыкания вместо классов (классы только `EngineError` и `EngineCallError`, наследники `Error`); стратегии — lookup-объекты и `Map`; Context вместо глобалов; GoF Proxy не используется, нативный `Proxy` запрещён (клиентский фасад строится из таблицы `RPC_METHODS`) |
| Порядок команд | Одна FIFO-очередь на движок, внутри движка (не в транспорте); `practice.submitAnswer` вне очереди |
| Ошибки | Домен бросает обычные `Error` (баги), операционные проблемы — `EngineError(code)`; на границе RPC → `EngineErrorDto` |
| Параметры RPC | Позиционный массив аргументов метода (`params: unknown[]`), схема — `z.tuple` |
| Платформенно-зависимое | Диалог выбора папки — интерфейс `Platform` в мосте preload `window.lms.platform`, реализация в main (инверсия управления, как `Files` в Lyricistant) |
| Оболочка main | Собрана из «шеллов» `{ register() }` (аналог `Manager` из Lyricistant): `window`, `engine`, `platform`, `lifecycle` |

## 1. Три вида кода и процессы

Схема: кто с кем говорит; движок и всё, что его окружает, — в одном отдельном процессе.

```
renderer (Vue, sandbox)        preload (sandbox)          main (Electron API)              utilityProcess "lms-engine"
src/**  ── LearningEngine ──►  window.lms.{engine,platform}  shells: window/engine/platform/lifecycle   host/index.ts
        ◄── MessagePort (RpcRequest/Response/Push) ──────────────────────── (порт передаёт main) ──►  dispatcher + engine
                                                                   supervisor: fork, restart, connect        SqliteEventStore
                                                                                                             SqlVerifier ─► дочерние процессы
```

Разделение кода на три вида (dev.to) определяет, какие зависимости разрешены.

| Вид кода | Где | Зависимости |
|---|---|---|
| UI-код | renderer, `apps/desktop/src/**` | Знает только `LearningEngine` из `@lms/engine-contract` (через `import type`) и `@lms/engine-rpc/client`; `electron` не импортирует |
| Платформенно-специфичный | main, preload, `electron/host/index.ts` (тонкая проводка) | `electron`, типы и константы `@lms/engine-contract` |
| Платформенно-независимый | `@lms/engine`, `@lms/engine-rpc`, `@lms/engine-sqlite`, `@lms/engine-sql-runner` | Без `electron`; работает в Node, в vitest и, теоретически, в вебе |

## 2. Раскладка пакетов и правила зависимостей

Дерево: что где лежит (новое — `engine-rpc`, `apps/desktop/electron/host`, `shared/bridge.ts`, `src/engine`).

```
packages/engine-contract/src/  index.ts (типы), constants.ts (CONTRACT_VERSION, MAX_SQL_CHARS), rpc.ts (RPC_METHODS, RPC_CONTROL, Rpc*, MessageEndpoint)
packages/engine/src/
  domain/ scoring/ scheduler/ authoring/ placement/ planning/ verify/ sync/   чистые, без node:*
  ports/index.ts
  app/   errors.ts context.ts create-engine.ts facade.ts command-queue.ts event-bus.ts expiring-map.ts journal-writer.ts services/{library,practice,curation,settings,sync,plan,placement,remediation}.ts
  node/  адаптеры и nodeDefaults(config)           (subpath ./node)
packages/engine-sqlite/src/      openSqliteEventStore
packages/engine-sql-runner/src/  createSqlVerifier
packages/engine-rpc/src/         client/ (client.ts, dom-port.ts)  host/ (dispatcher.ts, schemas.ts, node-port.ts)  in-process.ts
apps/desktop/electron/main/      index.ts, shells/{window,engine,platform,lifecycle}.ts, supervisor.ts
apps/desktop/electron/host/      index.ts, boot.ts
apps/desktop/electron/preload/   index.ts
apps/desktop/shared/bridge.ts    тип LmsBridge (включён в оба tsconfig)
apps/desktop/src/engine/         connect.ts, use-*.ts
```

| Модуль | Может импортировать | Не может |
|---|---|---|
| `domain`, `scoring`, `scheduler` | друг друга и `ports` (только типы) | `node:*`, `app`, адаптеры |
| `app` | домен и `ports` | адаптеры, `node:*` |
| `node/` и адаптеры (`engine-sqlite`, `engine-sql-runner`) | `ports` (типы) и Node | `app`, `electron` |
| `engine-rpc/client` | `engine-contract` | zod, `@lms/engine`, `electron` |
| `engine-rpc/host` | `engine-contract`, `@lms/engine` (для `EngineError`), zod | `electron` |
| main (`electron/main`) | `engine-contract` (типы, константы), `electron` | `@lms/engine` |
| renderer (`src/**`) | `engine-contract` (типы), `engine-rpc/client`, Vue | `electron`, `@lms/engine`, `@lms/engine-sqlite`, `@lms/engine-sql-runner` |

Планируемое усиление линтера (не в этой задаче): правила `no-restricted-imports` для `electron` и для `@lms/engine`, `@lms/engine-sqlite`, `@lms/engine-sql-runner` в `apps/desktop/src/**` и для `@lms/engine` в `apps/desktop/electron/main/**`; сейчас границы держатся только ревью.

## 3. Стиль реализации (metarhia)

Соответствие имён: в псевдокоде классы `engine-ts.md` записаны фабриками — `SqliteEventStore` → `openSqliteEventStore`, `SqlVerifier` → `createSqlVerifier`, `FolderSync` → сервис `sync.folder`; в остальных документах имена не переименовываются.

| Скилл | Как применено |
|---|---|
| `js-conventions` | `camelCase`; `UpperCamelCase` для типов и классов; `UPPER_SNAKE_CASE` для констант (`FIVE_MIN_MS`, `RPC_METHODS`); единицы в именах (`timeoutMs`, `ttlMs`); `error` в `catch`; `null` для пустых ссылок; стрелочные функции; одинарные кавычки, точки с запятой, 80 колонок; комментарии только там, где не очевидно |
| `js-gof` | Context (`EngineContext` передаётся в `createXService(ctx)`); Facade (`createEngine` → `LearningEngine`); Wrapper (`wrapTree` оборачивает каждый метод очередью, логированием и маппингом ошибок); Factory (`createX`); Adapter (порты ↔ better-sqlite3, `fromDomPort`, `fromNodePort`); Strategy через lookup (`GRADE_POLICIES`, `verifiers: Map<runner, Verifier>`, `RatingMap`); Command (`RpcRequest` — объект-команда); Observer (`EventBus`, свой `Set`); Bridge (`MessageEndpoint` отделяет диспетчер и клиент от транспорта). Нативный `Proxy` не используется |
| `error-handling` | Программные ошибки ≠ операционные. Операционные → `EngineError` (аналог `DomainError` скилла; контракт API §1 фиксирует исключения, а не возвращаемые значения); наружу только коды; process-level `uncaughtException` (лог и `exit(1)`) и `unhandledRejection` (лог, считать багом); graceful shutdown; retry с backoff (супервизор) и повтор идемпотентных запросов (клиент) |
| `js-data-structures` | DTO — plain-объекты и массивы; `Map` для динамических реестров (`clients`, `pending`, `attempts`, `verifiers`); `Set` для слушателей и для `UNQUEUED`; `Object.create(null)` для таблицы обработчиков; все долгоживущие коллекции ограничены (`ExpiringMap`: ёмкость и TTL); `Array.shift` не используется (очередь — цепочка промисов) |

## 4. Порты и корень композиции

Порты `packages/engine/src/ports/index.ts`. `MemoryModel` и `Rng` — как в `engine-ts.md` §6, здесь не повторяются; остальные сигнатуры в дизайне не были выписаны, введены здесь **[ВЫВОД]**.

```ts
import type { EpochMs, SubmissionDto, VerdictDto } from '@lms/engine-contract';
import type { LogEntry } from '../domain/journal.ts';

export interface Clock {
  now(): EpochMs;
}
export interface IdGenerator {
  next(): string; // uuidv7
}
export interface Logger {
  debug(fields: object, message?: string): void;
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}

export interface AppendResult {
  appended: readonly LogEntry[];
  duplicates: readonly string[]; // id уже был в журнале
}

export interface EventStore {
  readonly deviceId: string;
  lastSeq(): number; // кэш, обновляется append
  maxAt(): EpochMs; // максимальный увиденный at
  append(entries: readonly LogEntry[]): Promise<AppendResult>; // одна транзакция
  readAll(): AsyncIterable<LogEntry>; // ORDER BY at, device_id, seq
  close(): Promise<void>;
  // методы синхронизации и конфликтов — engine-ts.md §6a.6
}

export type RawVerdict = DistributiveOmit<
  VerdictDto,
  'attemptId' | 'attemptsUsed'
>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface VerifyRequest {
  exercise: ExerciseManifest;
  submission: SubmissionDto;
  timeoutMs: number;
  authorMode: boolean;
}
export interface Verifier {
  readonly runner: string; // 'sql'
  check(request: VerifyRequest): Promise<RawVerdict>; // error-вердикт — данные, не исключение
  close(): Promise<void>;
}
```

Корень композиции `packages/engine/src/app/create-engine.ts` (Context + Facade). `createContext` открывает библиотеку (артефакт; при устаревшем — фоновая компиляция и событие `library-compiled`), перестраивает проекции из журнала (событие `state-rebuilt`), загружает настройки и строит `Map` верификаторов по `runner`.

```ts
export interface EngineDeps {
  clock: Clock;
  rng: Rng;
  ids: IdGenerator;
  logger: Logger;
  courseSource: CourseSource;
  eventStore: EventStore;
  settings: SettingsStore;
  memoryModel: MemoryModel;
  verifiers: readonly Verifier[];
}

export interface EngineContext {
  readonly config: EngineConfig;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly rng: Rng;
  readonly logger: Logger;
  readonly eventStore: EventStore;
  readonly settings: SettingsStore;
  readonly memory: MemoryModel;
  readonly verifiers: ReadonlyMap<string, Verifier>;
  readonly library: LibraryHolder; // current() | require(); swap() атомарно
  readonly projections: Projections; // AttemptIndex, RewardIndex, FlagState, MemoryIndex
  readonly session: SessionState; // frequencyMap, relearn pile
  readonly attempts: ExpiringMap<OpenAttempt>;
  readonly gradePolicy: GradePolicy;
  readonly journal: JournalWriter;
  readonly bus: EventBus;
  readonly state: { dirty: boolean; closed: boolean };
  rebuild(): Promise<void>;
  markDirty(): void;
}

export const createEngine = async (
  deps: EngineDeps,
  config: EngineConfig,
): Promise<LearningEngine> => {
  const ctx = await createContext(deps, config);
  // createContext: 1) library.open (артефакт, при устаревшем — фоновая
  // компиляция и событие library-compiled); 2) rebuild() проекций из журнала
  // (событие state-rebuilt); 3) settings.load(); verifiers → Map по runner.
  const services = {
    library: createLibraryService(ctx),
    practice: createPracticeService(ctx),
    curation: createCurationService(ctx),
    settings: createSettingsService(ctx),
    sync: createSyncService(ctx),
    plan: createPlanService(ctx),
    placement: createPlacementService(ctx),
    remediation: createRemediationService(ctx),
  };
  return createFacade(ctx, services);
};
```

Фасад `app/facade.ts` (Wrapper): рекурсивно оборачивает каждый метод сервисов.

```ts
const UNQUEUED = new Set(['practice.submitAnswer']);

const wrapTree = (node, path, wrap) => {
  const wrapped = {};
  for (const [key, value] of Object.entries(node)) {
    const name = path === '' ? key : `${path}.${key}`;
    wrapped[key] =
      typeof value === 'function'
        ? wrap(name, value)
        : wrapTree(value, name, wrap);
  }
  return wrapped;
};

export const createFacade = (ctx, services) => {
  const { bus, logger, state } = ctx;
  const queue = createCommandQueue();
  const mapError = createErrorMapper(ctx);

  const wrap =
    (name, method) =>
    (...args) => {
      if (state.closed) return Promise.reject(new EngineError('ENGINE_CLOSED'));
      const run = async () => {
        if (state.dirty) await ctx.rebuild();
        const startedAt = performance.now();
        try {
          const result = await method(...args);
          bus.flush(); // события — после завершения команды, батчем
          return result;
        } catch (error) {
          bus.discard();
          throw mapError(error, name);
        } finally {
          logger.debug({ name, ms: performance.now() - startedAt });
        }
      };
      return UNQUEUED.has(name) ? run() : queue.enqueue(run);
    };

  const close = async () => {
    state.closed = true; // новые вызовы → ENGINE_CLOSED
    await queue.idle(); // дождаться текущей команды
    await Promise.allSettled([...ctx.verifiers.values()].map((v) => v.close()));
    await ctx.eventStore.close();
  };

  return {
    ...wrapTree(services, '', wrap),
    diagnostics: wrap('diagnostics', () => collectDiagnostics(ctx)),
    subscribe: bus.subscribe,
    close,
  };
};
```

Сервисы вызывают друг друга через `ctx` и внутренние объекты, **не** через обёрнутый фасад: иначе команда ждёт саму себя в очереди. `mapError` и `dirty` — §5. `submitAnswer` вне очереди, потому что вердикт ждёт раннер до `timeoutMs + 100 мс` и заблокировал бы остальные команды **[ВЫВОД]**; `library.compile` и `sync.folder.sync` остаются в очереди (API §9).

## 5. Ошибки

`packages/engine/src/app/errors.ts`. Таблица `ERRORS` содержит все 22 кода `EngineErrorCode` (API §2) с `retryable` по API §8.

```ts
import type { EngineErrorCode, EngineErrorDto } from '@lms/engine-contract';

const ERRORS: Record<EngineErrorCode, { message: string; retryable: boolean }> =
  {
    INVALID_ARGUMENT: { message: 'Invalid argument', retryable: false },
    NOT_FOUND: { message: 'Not found', retryable: false },
    ENGINE_CLOSED: { message: 'Engine is closed', retryable: true },
    INCOMPATIBLE_CONTRACT: {
      message: 'Incompatible contract version',
      retryable: false,
    },
    LIBRARY_NOT_LOADED: { message: 'Library is not loaded', retryable: false },
    LIBRARY_INVALID: { message: 'Library has errors', retryable: false },
    ASSET_OUTSIDE_LIBRARY: {
      message: 'Asset is outside the library',
      retryable: false,
    },
    ASSET_TOO_LARGE: { message: 'Asset is too large', retryable: false },
    ATTEMPT_NOT_FOUND: { message: 'Attempt not found', retryable: false },
    ATTEMPT_CLOSED: { message: 'Attempt is already closed', retryable: false },
    VERIFIER_UNAVAILABLE: {
      message: 'Verifier is unavailable',
      retryable: true,
    },
    VERIFIER_TIMEOUT: {
      message: 'Verifier deadline exceeded',
      retryable: true,
    },
    PLACEMENT_SESSION_NOT_FOUND: {
      message: 'Placement session not found',
      retryable: false,
    },
    PLACEMENT_SESSION_ACTIVE: {
      message: 'Placement session is active',
      retryable: false,
    },
    PLACEMENT_BUDGET_EXHAUSTED: {
      message: 'Placement budget exhausted',
      retryable: false,
    },
    SYNC_DEVICE_ID_CLASH: {
      message: 'Device id clash in sync folder',
      retryable: false,
    },
    SYNC_CONFLICT_NOT_FOUND: {
      message: 'Sync conflict not found',
      retryable: false,
    },
    SYNC_FOLDER_NOT_CONFIGURED: {
      message: 'Sync folder is not configured',
      retryable: false,
    },
    STORE_BUSY: { message: 'Store is busy', retryable: true },
    STORE_READONLY: { message: 'Store is read-only', retryable: false },
    STORE_CORRUPT: { message: 'Store is corrupt', retryable: false },
    INTERNAL: { message: 'Internal engine error', retryable: true },
  };

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: EngineErrorCode,
    options: {
      message?: string;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERRORS[code].message, { cause: options.cause });
    this.code = code;
    this.retryable = options.retryable ?? ERRORS[code].retryable;
    if (options.details) this.details = options.details;
  }

  toDto(): EngineErrorDto {
    const { code, message, retryable, details } = this;
    return details
      ? { code, message, retryable, details }
      : { code, message, retryable };
  }
}

export const createErrorMapper =
  ({ logger, markDirty }) =>
  (error: unknown, path: string): EngineError => {
    if (error instanceof EngineError) return error; // операционная ошибка
    logger.error({ error, path }, 'programming error'); // баг: не глотать
    markDirty(); // перестройка проекций при следующем чтении
    return new EngineError('INTERNAL', { cause: error, details: { path } });
  };
```

Адаптеры сами бросают `EngineError` со своими кодами: `SqliteEventStore` — `SQLITE_BUSY` → `STORE_BUSY`, `SQLITE_READONLY` → `STORE_READONLY`, `SQLITE_CORRUPT` → `STORE_CORRUPT`. `VERIFIER_UNAVAILABLE` — `retryable: false` при `details.cause === 'no-runner'`, иначе `true` (значение по умолчанию в таблице — `true`; для `no-runner` `retryable: false` передаётся явно). Проверка, превысившая `timeoutMs`, — вердикт `error/timeout`, не исключение (API §8). Домен и планировщик при нарушенных предусловиях бросают обычные `TypeError`/`Error` — это баги: они доходят до `mapError` и становятся `INTERNAL` с логом. Ошибки валидации аргументов в RPC — `INVALID_ARGUMENT` (§8).

## 6. Служебные механизмы

Очередь команд, шина событий и реестр с ёмкостью и TTL — три маленьких замыкания в `packages/engine/src/app/`.

```ts
export const createCommandQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.catch(() => null); // цепочка не рвётся; ошибка вернётся вызывающему
    return result;
  };
  const idle = () => tail;
  return { enqueue, idle };
};

export const createEventBus = (logger: Logger) => {
  const listeners = new Set<(event: EngineEvent) => void>();
  let buffer: EngineEvent[] = [];
  const emit = (event: EngineEvent) => {
    buffer.push(event);
  };
  const discard = () => {
    buffer = [];
  };
  const flush = () => {
    const batch = buffer;
    buffer = [];
    for (const event of batch) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          logger.error({ error, type: event.type }, 'event listener failed');
        }
      }
    }
  };
  const subscribe = (listener: (event: EngineEvent) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { emit, discard, flush, subscribe };
};

export const createExpiringMap = <T,>({ capacity, ttlMs, clock }) => {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const sweep = () => {
    const now = clock.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  };
  const set = (key: string, value: T) => {
    sweep();
    if (entries.size >= capacity) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest); // вытеснение самой старой
    }
    entries.set(key, { value, expiresAt: clock.now() + ttlMs });
  };
  const get = (key: string): T | undefined => {
    sweep();
    return entries.get(key)?.value;
  };
  return { set, get, delete: (key: string) => entries.delete(key) };
};
```

Очередь — цепочка промисов, не массив (никаких `shift`). `attempts = createExpiringMap({ capacity: 100, ttlMs: 86_400_000, clock })` (лимиты API §10); тот же помощник — для сессий `placement` (TTL 24 ч). `discard` при сбое команды: если журнал уже записан, а проекции упали, событие `progress` не уходит, состояние `dirty`; клиент повторяет `recordAttempt` с тем же `requestId` и получает `duplicate: true` (идемпотентность), следующее чтение перестраивает проекции. Слушатель не вызывает команды синхронно из обработчика (API §7) — UI откладывает вызов через `queueMicrotask`.

## 7. Сервис практики

`packages/engine/src/app/journal-writer.ts` — единственное место, где строится запись журнала: номер `seq` без пропусков и `at` по HLC-правилу (`engine-ts.md` §5.1).

```ts
const FIVE_MIN_MS = 300_000;

export const createJournalWriter = ({ clock, ids, eventStore }) => {
  let seq = eventStore.lastSeq();
  let ownPrevAt = 0;

  const computeAt = (requestedAt?: EpochMs) => {
    const requested = requestedAt ?? clock.now();
    const clamped = Math.min(requested, clock.now() + FIVE_MIN_MS);
    return Math.max(clamped, eventStore.maxAt() + 1, ownPrevAt); // HLC-правило §5.1
  };

  const build = (fields, { id, at }: { id?: string; at?: EpochMs } = {}) => ({
    ...fields,
    id: id ?? ids.next(),
    deviceId: eventStore.deviceId,
    seq: seq + 1, // без пропусков: seq растёт только после успешного append
    at: computeAt(at),
    recordedAt: clock.now(),
  });

  const commit = (entry) => {
    seq = entry.seq;
    ownPrevAt = entry.at;
  };

  return { build, commit };
};
```

`packages/engine/src/app/services/practice.ts` — эталон для остальных сервисов. Метод `recordAttempt` повторяет «Поток записи попытки» `engine-ts.md` §4.

```ts
const GRADES = new Set([1, 2, 3, 4, 5]);
const PASS_AT_GRADE = [5, 4, 3]; // pass@1 → 5, pass@2 → 4, pass@3+ → 3

const GRADE_POLICIES = {
  passAtN: ({ verdicts, gaveUp }) => {
    if (gaveUp) return 1;
    const graded = verdicts.filter((verdict) => verdict.outcome !== 'error');
    const passIndex = graded.findIndex(
      (verdict) => verdict.outcome === 'passed',
    );
    if (passIndex === -1) return null; // нужна самооценка или gave-up
    return PASS_AT_GRADE[Math.min(passIndex, PASS_AT_GRADE.length - 1)];
  },
};

export const createPracticeService = (ctx: EngineContext): PracticeService => {
  const { clock, ids, eventStore, library, projections, session, attempts } =
    ctx;
  const { verifiers, journal, bus, config } = ctx;

  const recordAttempt = async ({
    requestId,
    exerciseId,
    grade,
    at,
    source = 'self',
  }: RecordAttemptRequest): Promise<RecordResultDto> => {
    const graph = library.require(); // LIBRARY_NOT_LOADED | LIBRARY_INVALID
    if (!GRADES.has(grade)) {
      throw new EngineError('INVALID_ARGUMENT', { details: { grade } }); // шаг 1
    }
    if (!graph.hasExercise(exerciseId)) {
      throw new EngineError('NOT_FOUND', { details: { exerciseId } });
    }
    const entry = journal.build(
      { kind: 'attempt', exerciseId, grade, source },
      { id: requestId, at },
    ); // шаг 2
    const { duplicates } = await eventStore.append([entry]); // шаг 3
    if (duplicates.includes(entry.id)) {
      return replayDuplicate(ctx, entry.id, exerciseId); // без remediation
    }
    journal.commit(entry);
    try {
      const unitIds = projections.applyAttempt(entry, graph); // шаг 4
      ctx.scorer.invalidate(unitIds); // шаг 5
      session.noteResult(exerciseId, grade);
      const remediation = ctx.remediation.onAttempt(entry, graph);
      bus.emit({ type: 'progress', unitIds, at: entry.at }); // шаг 6
      if (remediation) {
        bus.emit({
          type: 'remediation-triggered',
          exerciseId,
          steps: remediation.steps.length,
          at: entry.at,
        });
      }
      return {
        eventId: entry.id,
        exerciseId,
        grade,
        at: entry.at,
        duplicate: false,
        affected: unitIds.map((unitId) => ctx.scorer.unitScore(unitId)),
        ...(remediation && { remediation }),
      };
    } catch (error) {
      ctx.markDirty(); // журнал уже записан; rebuild на следующем чтении
      throw error;
    }
  };

  const beginAttempt = ({ exerciseId }) => {
    const exercise = library.require().getExercise(exerciseId);
    if (!exercise)
      throw new EngineError('NOT_FOUND', { details: { exerciseId } });
    const attemptId = ids.next();
    const verifiable = exercise.engine?.verification != null;
    const startedAt = clock.now();
    attempts.set(attemptId, {
      attemptId,
      exerciseId,
      verifiable,
      verdicts: [],
      busy: false,
      result: null,
    });
    return {
      attemptId,
      exercise: toExerciseDto(exercise),
      startedAt,
      verifiable,
    };
  };

  const submitAnswer = async ({ attemptId, submission }) => {
    const attempt = attempts.get(attemptId);
    if (!attempt)
      throw new EngineError('ATTEMPT_NOT_FOUND', { details: { attemptId } });
    if (attempt.result)
      throw new EngineError('ATTEMPT_CLOSED', { details: { attemptId } });
    if (!attempt.verifiable || attempt.busy) {
      throw new EngineError('INVALID_ARGUMENT', { details: { attemptId } });
    }
    const exercise = library.require().getExercise(attempt.exerciseId);
    const { runner, timeoutMs } = exercise.engine.verification;
    const verifier = verifiers.get(runner); // Strategy через Map
    if (!verifier) {
      throw new EngineError('VERIFIER_UNAVAILABLE', {
        retryable: false,
        details: { cause: 'no-runner', runner },
      });
    }
    attempt.busy = true; // критическая секция вокруг await — один вердикт за раз
    try {
      const raw = await verifier.check({
        exercise,
        submission,
        timeoutMs,
        authorMode: config.authorMode ?? false,
      });
      const verdict = {
        ...raw,
        attemptId,
        attemptsUsed: countGraded(attempt, raw),
      };
      if (raw.outcome !== 'error') attempt.verdicts.push(verdict); // error не пишется
      return verdict;
    } finally {
      attempt.busy = false;
    }
  };

  const completeAttempt = async ({ attemptId, grade, outcome }) => {
    const attempt = attempts.get(attemptId);
    if (!attempt)
      throw new EngineError('ATTEMPT_NOT_FOUND', { details: { attemptId } });
    if (attempt.result) return { ...attempt.result, duplicate: true };
    const derived = attempt.verifiable
      ? ctx.gradePolicy({
          verdicts: attempt.verdicts,
          gaveUp: outcome === 'gave-up',
        })
      : null;
    const finalGrade = derived ?? grade ?? null;
    if (finalGrade === null) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: { attemptId, need: 'grade' },
      });
    }
    const result = await recordAttempt({
      requestId: attemptId, // идемпотентность completeAttempt по attemptId
      exerciseId: attempt.exerciseId,
      grade: finalGrade,
      source: attempt.verifiable ? 'runner' : 'self',
    });
    attempt.result = result;
    return result;
  };

  // startSession, getBatch, getUnitScore, getAttempts, getProgress, getFrontier,
  // getDue, resetProgress — по engine-ts.md §4 (потоки) и API §4 (семантика)
  return Object.freeze({
    recordAttempt,
    beginAttempt,
    submitAnswer,
    completeAttempt,
    // остальные методы PracticeService
  });
};
```

Что важно в блоке:

- Шаги 1–6 в комментариях соответствуют «Потоку записи попытки» `engine-ts.md` §4: проверка → сбор события → `append` → проекции → кэши → событие `progress`.
- `ctx.gradePolicy` по умолчанию `GRADE_POLICIES.passAtN`; выбор политики из настроек — M5 **[НЕ ПОДТВЕРЖДЕНО]**.
- На дубликате `affected` пересчитывается по текущему состоянию, `remediation` не возвращается **[ВЫВОД]**.
- `completeAttempt` для проверяемой попытки без `passed`-вердикта, без `gave-up` и без `grade` — `INVALID_ARGUMENT` (обобщение правила API §4 про «только `error`») **[ВЫВОД]**.
- `attempt.busy` защищает единственную гонку: `submitAnswer` идёт вне очереди, а между `await` могут прийти другие вызовы.

Остальные сервисы строятся так же (`createXService(ctx)` → замороженный объект методов):

| Сервис | Порты и `ctx` | События | Очередь |
|---|---|---|---|
| `library` | `courseSource`, `library` | `library-reloaded`, `library-compiled` | В очереди; `compile` и `reload` длинные — остальные ждут |
| `curation` | `journal` (для `unit_flag`), `settings` | `settings-changed`, scope `blacklist`/`reviewList`/`filters`/`sessions` | В очереди |
| `settings` | `settings` | `settings-changed` | В очереди |
| `sync` | `eventStore`, `FolderSync` | `sync-conflict`, `state-rebuilt` | `folder.sync` в очереди |
| `plan` | `projections`, `scorer`, `rng` | Нет: чистая функция состояния и `seed` | В очереди |
| `placement` | `createExpiringMap` для сессий, `journal` при `finish` с `source: 'placement'` | Нет | В очереди |
| `remediation` | Проекция `RemediationTracker`; `getPlan` — чтение | `remediation-triggered` эмитит `practice` | В очереди |

## 8. Транспорт (`@lms/engine-rpc`)

`packages/engine-contract/src/rpc.ts` — только типы и константы. Таблица `RPC_METHODS` содержит по одной строке на каждый метод `LearningEngine` и вложенных сервисов из API §3–§7, кроме `subscribe` и `close`: по RPC их нет (`subscribe` заменён служебными сообщениями `RPC_CONTROL`, `close` из renderer не вызывается никогда). `idempotent: true` — методы, перечисленные идемпотентными в API §1 (`recordAttempt`, `completeAttempt`, `placement.finish`, `resetProgress`, `sync.import`, `sync.folder.sync`) и все чтения без побочных эффектов (`get*`, `list*`, `matchPrefix`, `readAsset`, `has`, `plan.getDay`, `remediation.getPlan`, `library.validate`, `diagnostics`); остальные — `false` (API §1: `getBatch`, `startSession`, `beginAttempt`, `placement.start`/`answer`, `sync.resolveConflict` и прочие команды).

```ts
export interface MessageEndpoint {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export const RPC_METHODS = {
  'library.getInfo': { idempotent: true },
  'library.getDiagnostics': { idempotent: true },
  'library.validate': { idempotent: true },
  'library.compile': { idempotent: false },
  'library.reload': { idempotent: false },
  'library.listCourses': { idempotent: true },
  'library.listLessons': { idempotent: true },
  'library.listExercises': { idempotent: true },
  'library.getUnit': { idempotent: true },
  'library.matchPrefix': { idempotent: true },
  'library.getGraph': { idempotent: true },
  'library.readAsset': { idempotent: true },
  'practice.startSession': { idempotent: false },
  'practice.getBatch': { idempotent: false }, // RNG и счётчик показов
  'practice.beginAttempt': { idempotent: false },
  'practice.submitAnswer': { idempotent: false },
  'practice.completeAttempt': { idempotent: true }, // по attemptId
  'practice.recordAttempt': { idempotent: true }, // по requestId
  'practice.getUnitScore': { idempotent: true },
  'practice.getAttempts': { idempotent: true },
  'practice.getProgress': { idempotent: true },
  'practice.getFrontier': { idempotent: true },
  'practice.getDue': { idempotent: true },
  'practice.resetProgress': { idempotent: true }, // по requestId
  'plan.getDay': { idempotent: true }, // при заданном seed
  'placement.start': { idempotent: false },
  'placement.nextProbe': { idempotent: true }, // до ответа на выданную пробу
  'placement.answer': { idempotent: false },
  'placement.finish': { idempotent: true }, // по requestId
  'placement.abort': { idempotent: false },
  'remediation.getPlan': { idempotent: true },
  'curation.blacklist.list': { idempotent: true },
  'curation.blacklist.has': { idempotent: true },
  'curation.blacklist.add': { idempotent: false },
  'curation.blacklist.remove': { idempotent: false },
  'curation.blacklist.removePrefix': { idempotent: false },
  'curation.reviewList.list': { idempotent: true },
  'curation.reviewList.has': { idempotent: true },
  'curation.reviewList.add': { idempotent: false },
  'curation.reviewList.remove': { idempotent: false },
  'curation.reviewList.removePrefix': { idempotent: false },
  'curation.filters.list': { idempotent: true },
  'curation.filters.get': { idempotent: true },
  'curation.filters.save': { idempotent: false },
  'curation.filters.delete': { idempotent: false },
  'curation.sessions.list': { idempotent: true },
  'curation.sessions.get': { idempotent: true },
  'curation.sessions.save': { idempotent: false },
  'curation.sessions.delete': { idempotent: false },
  'settings.getScheduler': { idempotent: true },
  'settings.setScheduler': { idempotent: false },
  'settings.resetScheduler': { idempotent: false },
  'settings.getPreferences': { idempotent: true },
  'settings.setPreferences': { idempotent: false },
  'settings.getScorer': { idempotent: true },
  'sync.getState': { idempotent: true },
  'sync.exportSince': { idempotent: true },
  'sync.import': { idempotent: true }, // по id записи
  'sync.rebuild': { idempotent: false },
  'sync.importFromTrane': { idempotent: false },
  'sync.getConflicts': { idempotent: true },
  'sync.resolveConflict': { idempotent: false },
  'sync.folder.configure': { idempotent: false },
  'sync.folder.sync': { idempotent: true }, // по содержимому сегментов
  'sync.folder.checkRestore': { idempotent: false },
  diagnostics: { idempotent: true },
} as const satisfies Record<string, { idempotent: boolean }>;

export type RpcMethodName = keyof typeof RPC_METHODS;

/** Служебные: обрабатывает диспетчер, не движок. */
export const RPC_CONTROL = [
  'engine.hello',
  'events.subscribe',
  'events.unsubscribe',
] as const;
```

Формат сообщений — `RpcRequest`/`RpcResponse`/`RpcPush` из API §9 без изменений; `params` — массив позиционных аргументов метода.

Хост-диспетчер `packages/engine-rpc/src/host/dispatcher.ts` и `schemas.ts`: схемы zod по одной на каждый ключ `RPC_METHODS` (тип `satisfies` не даёт пропустить метод или ошибиться в аргументах), обработчики — из движка по пути `'sync.folder.sync'`.

```ts
type Path<T, K extends string> = K extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? Path<T[Head], Tail>
    : never
  : K extends keyof T
    ? T[K]
    : never;
type ArgsOf<K extends RpcMethodName> =
  Path<LearningEngine, K> extends (...args: infer A) => unknown ? A : never;

export const schemas = {
  'library.getInfo': z.tuple([]),
  'practice.getBatch': z.tuple([BatchRequestSchema.optional()]),
  'practice.recordAttempt': z.tuple([RecordAttemptRequestSchema]),
  'practice.completeAttempt': z.tuple([CompleteAttemptRequestSchema]),
  // по одной схеме на каждый ключ RPC_METHODS
} satisfies { [K in RpcMethodName]: z.ZodType<ArgsOf<K>> };

export const createDispatcher = ({ engine, schemas, logger }) => {
  const handlers = Object.create(null);
  for (const name of Object.keys(RPC_METHODS)) {
    handlers[name] = resolvePath(engine, name); // 'sync.folder.sync' → функция
  }
  assertSameKeys(Object.keys(RPC_METHODS), Object.keys(schemas)); // fail-fast
  const clients = new Map();

  const control = {
    'engine.hello': async (client, [hello]) => {
      if (hello?.contractVersion !== CONTRACT_VERSION) {
        throw new EngineError('INCOMPATIBLE_CONTRACT', {
          details: { host: CONTRACT_VERSION, client: hello?.contractVersion },
        });
      }
      const { engineVersion } = await engine.diagnostics();
      return { contractVersion: CONTRACT_VERSION, engineVersion };
    },
    'events.subscribe': (client) => {
      client.unsubscribe ??= engine.subscribe((event) =>
        client.endpoint.post({ event }),
      );
      return null;
    },
    'events.unsubscribe': (client) => {
      client.unsubscribe?.();
      client.unsubscribe = null;
      return null;
    },
  };

  const handle = async (client, { id, method, params }) => {
    try {
      const run = control[method];
      if (run) return { id, ok: true, result: await run(client, params ?? []) };
      const schema = schemas[method];
      if (!schema)
        throw new EngineError('INVALID_ARGUMENT', { details: { method } });
      const parsed = schema.safeParse(params ?? []); // renderer — недоверенный вход
      if (!parsed.success) {
        const issues = parsed.error.issues.map(({ path, message }) => ({
          path,
          message,
        }));
        throw new EngineError('INVALID_ARGUMENT', {
          details: { method, issues },
        });
      }
      const result = await handlers[method](...parsed.data);
      return { id, ok: true, result };
    } catch (error) {
      if (error instanceof EngineError)
        return { id, ok: false, error: error.toDto() };
      logger.error({ error, method }, 'dispatcher failure'); // движок уже маппит ошибки
      return { id, ok: false, error: new EngineError('INTERNAL').toDto() };
    }
  };

  const attach = (endpoint: MessageEndpoint, clientId: string) => {
    const client = { clientId, endpoint, unsubscribe: null };
    clients.set(clientId, client);
    endpoint.onMessage((message) => {
      handle(client, message as RpcRequest).then((response) =>
        endpoint.post(response),
      );
    });
    endpoint.onClose(() => {
      client.unsubscribe?.(); // снять слушателей: утечки нет (LogRocket)
      clients.delete(clientId);
    });
  };

  const closeAll = () => {
    for (const { endpoint } of clients.values()) endpoint.close();
  };

  return { attach, closeAll };
};
```

Ответы приходят не по порядку (`submitAnswer` вне очереди) — сопоставление по `id`. Результат должен быть structured-cloneable: в dev-сборке диспетчер вызывает `structuredClone(result)` перед `post`, чтобы `DataCloneError` ловился в тестах, а не в UI **[ВЫВОД]**. Если `z.tuple([X.optional()])` в zod 4.6.5 не принимает пустой массив, заменить на `z.union([z.tuple([]), z.tuple([X])])` **[НЕ ПОДТВЕРЖДЕНО]**. Адаптер `fromNodePort(port)` — структурный тип `{ on, postMessage, start, close }` для `MessagePortMain`: `port.on('message', (e) => listener(e.data))`, `port.on('close', …)`, `port.start()`. Адаптер `fromDomPort(port)` для renderer: `port.onmessage = (e) => listener(e.data)`, `port.addEventListener('close', …)`, `port.start()`.

Клиент `packages/engine-rpc/src/client/client.ts` строит фасад `LearningEngine` из таблицы `RPC_METHODS`, без `Proxy`.

```ts
export class EngineCallError extends Error {
  readonly code: EngineErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor({ code, message, retryable, details }: EngineErrorDto) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    if (details) this.details = details;
  }
}

export const createEngineClient = () => {
  const pending = new Map();
  const listeners = new Set<(event: EngineEvent) => void>();
  let endpoint: MessageEndpoint | null = null;
  let nextId = 0;

  const closedError = () =>
    new EngineCallError({
      code: 'ENGINE_CLOSED',
      message: 'Engine is closed',
      retryable: true,
    });

  const post = (entry) => {
    entry.sent = true;
    endpoint.post({ id: entry.id, method: entry.method, params: entry.args });
  };

  const request = (method: string, args: unknown[], { control = false } = {}) =>
    new Promise((resolve, reject) => {
      const entry = {
        id: String(nextId++),
        method,
        args,
        resolve,
        reject,
        sent: false,
        replayed: false,
      };
      const replayable = !control && RPC_METHODS[method].idempotent;
      if (endpoint) {
        pending.set(entry.id, entry);
        post(entry);
      } else if (replayable) {
        pending.set(entry.id, entry); // уйдёт после attach
      } else {
        reject(closedError());
      }
    });

  const onMessage = (message) => {
    if ('event' in message) {
      for (const listener of listeners) listener(message.event);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new EngineCallError(message.error));
  };

  const onClosed = () => {
    endpoint = null;
    for (const [id, entry] of pending) {
      const replayable =
        RPC_METHODS[entry.method]?.idempotent && !entry.replayed;
      if (replayable) {
        entry.sent = false; // один повтор после переподключения
        continue;
      }
      pending.delete(id);
      entry.reject(closedError());
    }
  };

  const attach = async (next: MessageEndpoint) => {
    endpoint = next;
    next.onMessage(onMessage);
    next.onClose(onClosed);
    await request('engine.hello', [{ contractVersion: CONTRACT_VERSION }], {
      control: true,
    });
    if (listeners.size > 0)
      await request('events.subscribe', [], { control: true });
    for (const entry of pending.values()) {
      if (entry.sent) continue;
      entry.replayed = true;
      post(entry);
    }
  };

  const engine = {};
  for (const name of Object.keys(RPC_METHODS)) {
    const path = name.split('.');
    let node = engine;
    for (const segment of path.slice(0, -1)) node = node[segment] ??= {};
    node[path.at(-1)] = (...args) => request(name, args);
  }
  engine.subscribe = (listener) => {
    listeners.add(listener);
    if (listeners.size === 1 && endpoint)
      void request('events.subscribe', [], { control: true });
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && endpoint)
        void request('events.unsubscribe', [], { control: true });
    };
  };
  engine.close = async () => endpoint?.close(); // закрывает только свой порт, не движок

  return { attach, engine: engine as LearningEngine };
};
```

Без таймаутов на вызов: живость определяется закрытием порта (`onClose`) и супервизором **[ВЫВОД]**. Неидемпотентные вызовы при обрыве получают `ENGINE_CLOSED` (`retryable: true`), решение о повторе принимает UI. Идемпотентные повторяются один раз после `attach`. Клиент — это `LearningEngine` для renderer, поэтому те же сценарии работают in-process в тестах.

In-process транспорт `packages/engine-rpc/src/in-process.ts` (аналог «вызвать слушателей самим» из Lyricistant, но с `structuredClone`, чтобы воспроизвести ограничения Electron).

```ts
const createSide = () => ({
  onMessage: new Set<(message: unknown) => void>(),
  onClose: new Set<() => void>(),
});

export const createInProcessPair = (): [MessageEndpoint, MessageEndpoint] => {
  const sides = [createSide(), createSide()] as const;
  let closed = false;

  const endpointOf = (self: 0 | 1): MessageEndpoint => {
    const peer = sides[self === 0 ? 1 : 0];
    return {
      post: (message) => {
        if (closed) return;
        const copy = structuredClone(message); // DataCloneError, как в Electron
        queueMicrotask(() => {
          for (const listener of peer.onMessage) listener(copy);
        });
      },
      onMessage: (listener) => {
        sides[self].onMessage.add(listener);
      },
      onClose: (listener) => {
        sides[self].onClose.add(listener);
      },
      close: () => {
        if (closed) return;
        closed = true;
        for (const side of sides) {
          for (const listener of side.onClose) listener();
        }
      },
    };
  };

  return [endpointOf(0), endpointOf(1)];
};
```

Пример контрактного теста (иллюстрация; файл теста в этой задаче не создаётся):

```ts
it('recordAttempt через RPC идемпотентен', async () => {
  const engine = await createTestEngine(); // @lms/testkit
  const dispatcher = createDispatcher({
    engine,
    schemas,
    logger: silentLogger,
  });
  const [hostSide, clientSide] = createInProcessPair();
  dispatcher.attach(hostSide, 'test');
  const client = createEngineClient();
  await client.attach(clientSide);
  const request = { requestId: 'r1', exerciseId: 'c::l::e', grade: 5 } as const;
  const first = await client.engine.practice.recordAttempt(request);
  const second = await client.engine.practice.recordAttempt(request);
  expect(second).toMatchObject({ eventId: first.eventId, duplicate: true });
});
```

## 9. Хост-процесс

`apps/desktop/electron/host/boot.ts` собирает зависимости и движок, `index.ts` — точка входа `utilityProcess`: получает `init` (конфиг), затем `connect` с портом на каждое окно, `shutdown` при выходе.

```ts
// boot.ts
export const boot = async (config: EngineConfig) => {
  const defaults = nodeDefaults(config); // clock, rng, ids, logger(stderr JSON), courseSource, settings, memoryModel
  const eventStore = openSqliteEventStore({
    path: join(config.dataDir, 'engine.db'),
    durability: config.durability ?? 'full',
  });
  const verifiers = [
    createSqlVerifier({ logger: defaults.logger, spawnWorker: fork }),
  ];
  const engine = await createEngine(
    { ...defaults, eventStore, verifiers },
    config,
  );
  return { engine, logger: defaults.logger };
};

// index.ts
const parentPort = process.parentPort;
let engine = null;
let dispatcher = null;

process.on('uncaughtException', (error) => {
  console.error({ error }, 'uncaught'); // состояние могло испортиться
  process.exit(1); // супервизор поднимет хост заново
});
process.on('unhandledRejection', (reason) => {
  console.error({ reason }, 'unhandled rejection'); // баг: исправлять
});

const shutdown = async () => {
  dispatcher?.closeAll(); // перестать принимать вызовы
  await engine?.close(); // дождаться очереди, закрыть раннеры и SQLite
  process.exit(0);
};

parentPort.on('message', async ({ data, ports }) => {
  if (data.type === 'init') {
    const booted = await boot(data.config);
    engine = booted.engine;
    dispatcher = createDispatcher({ engine, schemas, logger: booted.logger });
    parentPort.postMessage({ type: 'ready' });
  } else if (data.type === 'connect') {
    dispatcher.attach(fromNodePort(ports[0]), data.clientId);
  } else if (data.type === 'shutdown') {
    await shutdown();
  }
});
```

`spawnWorker` — внедряемая функция (по умолчанию `child_process.fork`): если `fork` внутри `utilityProcess` Electron 44 не заработает (открытый вопрос `engine-ts.md` §12.13), main порождает процессы раннера сам и передаёт хосту порты — тогда меняется только фабрика `spawnWorker` в `boot.ts` **[НЕ ПОДТВЕРЖДЕНО]**. Ошибка `boot` (кроме ошибок библиотеки — они внутри движка как состояние `library-invalid`) приводит к падению процесса и перезапуску супервизором; `STORE_CORRUPT` движок обрабатывает сам (режим чтения журнала).

## 10. Main: шеллы и супервизор

`apps/desktop/electron/main/index.ts` — только проводка: собрать зависимости, создать супервизор и шеллы, вызвать `register()`.

```ts
// main/index.ts
const deps = { app, ipcMain, dialog, logger };
const supervisor = createSupervisor({
  utilityProcess,
  MessageChannelMain,
  hostPath: path.join(__dirname, '../host/index.js'),
  config: {
    libraryRoot: path.join(app.getPath('userData'), 'library'),
    dataDir: path.join(app.getPath('userData'), 'data'),
  },
  logger,
});

const shells = [
  createWindowShell(deps),
  createEngineShell({ ...deps, supervisor }),
  createPlatformShell(deps),
  createLifecycleShell({ ...deps, supervisor }),
];
for (const shell of shells) shell.register();
```

Шеллы `main/shells/`: `engine` — единственная точка выдачи порта, `platform` — диалог выбора папки, `lifecycle` — остановка хоста при выходе. Шелл `window` описан ниже прозой.

```ts
// main/shells/engine.ts
export const createEngineShell = ({ ipcMain, supervisor }) => ({
  register: () => {
    ipcMain.on('engine:connect', (event) => {
      if (event.senderFrame !== event.sender.mainFrame) return; // только верхний фрейм
      supervisor.connect(event.sender);
    });
  },
});

// main/shells/platform.ts
export const createPlatformShell = ({ ipcMain, dialog }) => ({
  register: () => {
    ipcMain.handle('platform:pickDirectory', async (event, options) => {
      const title =
        typeof options?.title === 'string' ? options.title : undefined;
      const window = BrowserWindow.fromWebContents(event.sender);
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title,
        properties: ['openDirectory', 'createDirectory'],
      });
      return canceled ? null : filePaths[0];
    });
  },
});

// main/shells/lifecycle.ts
export const createLifecycleShell = ({ app, supervisor }) => ({
  register: () => {
    let stopped = false;
    app.on('before-quit', async (event) => {
      if (stopped) return;
      event.preventDefault();
      await supervisor.stop(); // shutdown хоста, не дольше 5 с, затем kill
      stopped = true;
      app.quit();
    });
  },
});
```

Супервизор `main/supervisor.ts`: поднимает хост, перезапускает с backoff, выдаёт каждому окну свежий порт.

```ts
// main/supervisor.ts
const WINDOW_MS = 60_000;
const MAX_CRASHES = 5;
const BACKOFF_CAP_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;

export const createSupervisor = ({
  utilityProcess,
  MessageChannelMain,
  hostPath,
  config,
  logger,
}) => {
  let child = null;
  let ready = false;
  let stopping = false;
  let crashTimes: number[] = [];
  const windows = new Set();

  const link = (webContents) => {
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: 'connect', clientId: String(webContents.id) }, [
      port1,
    ]);
    webContents.postMessage('engine:port', null, [port2]);
  };

  const start = () => {
    child = utilityProcess.fork(hostPath, [], { serviceName: 'lms-engine' });
    child.once('spawn', () => child.postMessage({ type: 'init', config }));
    child.on('message', (message) => {
      if (message.type !== 'ready') return;
      ready = true;
      for (const webContents of windows) link(webContents);
    });
    child.on('exit', (code) => {
      ready = false;
      child = null;
      if (stopping) return;
      const now = Date.now();
      crashTimes = [...crashTimes.filter((at) => now - at < WINDOW_MS), now];
      logger.error({ code, crashes: crashTimes.length }, 'engine host exited');
      if (crashTimes.length > MAX_CRASHES) return onFatal();
      const delayMs = Math.min(
        500 * 2 ** (crashTimes.length - 1),
        BACKOFF_CAP_MS,
      );
      setTimeout(start, delayMs);
    });
  };

  const connect = (webContents) => {
    windows.add(webContents);
    webContents.once('destroyed', () => windows.delete(webContents));
    if (ready) link(webContents); // иначе будет связано по 'ready'
  };

  const stop = () =>
    new Promise<void>((resolve) => {
      stopping = true;
      if (!child) return resolve();
      const timer = setTimeout(() => child?.kill(), STOP_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.postMessage({ type: 'shutdown' });
    });

  return { start, connect, stop };
};
```

`onFatal` показывает `dialog.showErrorBox` и вызывает `app.quit()`. При рестарте хоста все живые окна получают новый порт (`link` по `ready`), старые порты закрываются и клиент переподключается (§11); до `ready` `connect` только запоминает окно. `createWindowShell` фиксирует `webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false }`, `will-navigate` → `preventDefault`, `setWindowOpenHandler` → `deny` (внешние `https:` через `shell.openExternal`, как в шаблоне) и `requestSingleInstanceLock` (как в шаблоне). Числа перезапуска (5 падений за 60 с, backoff 500 мс·2ⁿ ≤ 5 с, остановка ≤ 5 с) — **[ВЫВОД]**.

## 11. Preload и renderer

Мост `window.lms` — узкий: ни `ipcRenderer`, ни произвольных каналов. Тип моста лежит в `apps/desktop/shared/bridge.ts`, реализация — в `electron/preload/index.ts`.

```ts
// shared/bridge.ts
export interface Platform {
  pickDirectory(options?: { title?: string }): Promise<string | null>;
}
export interface LmsBridge {
  engine: { connect(): void };
  platform: Platform;
}

// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

const windowLoaded = new Promise<void>((resolve) => {
  window.addEventListener('load', () => resolve(), { once: true });
});

ipcRenderer.on('engine:port', async (event) => {
  await windowLoaded; // страница должна успеть подписаться на message
  window.postMessage('engine:port', '*', event.ports); // порт → main world
});

const bridge: LmsBridge = {
  engine: { connect: () => ipcRenderer.send('engine:connect') },
  platform: {
    pickDirectory: (options) => {
      const title =
        typeof options?.title === 'string' ? options.title : undefined;
      return ipcRenderer.invoke('platform:pickDirectory', { title });
    },
  },
};
contextBridge.exposeInMainWorld('lms', bridge);
```

Renderer `apps/desktop/src/engine/`: `connect.ts` ждёт порт и рукопожатие, `main.ts` монтирует UI после него, `use-due.ts` — пример состояния UI, построенного из событий, а не из опроса (LogRocket).

```ts
// connect.ts
export const connectEngine = () =>
  new Promise<LearningEngine>((resolve, reject) => {
    const client = createEngineClient();
    let first = true;
    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data !== 'engine:port') return;
      try {
        await client.attach(fromDomPort(event.ports[0]));
        if (first) {
          first = false;
          resolve(client.engine);
        }
      } catch (error) {
        if (first) reject(error);
        else console.error(error); // переподключение не удалось
      }
    });
    window.lms.engine.connect();
  });

// main.ts
const engine = await connectEngine(); // UI монтируется после рукопожатия
createApp(App).provide(ENGINE_KEY, engine).mount('#app');

// use-due.ts — состояние UI строится из событий, а не из опроса (LogRocket)
export const useDue = (engine: LearningEngine) => {
  const items = ref<DueItemDto[]>([]);
  const refresh = async () => {
    items.value = (await engine.practice.getDue()).items;
  };
  const unsubscribe = engine.subscribe((event) => {
    if (event.type === 'progress') queueMicrotask(() => void refresh());
  });
  onScopeDispose(unsubscribe);
  void refresh();
  return { items, refresh };
};
```

Мост не отдаёт `ipcRenderer` и произвольные каналы (Habr, LogRocket) — шаблонный мост `window.ipcRenderer` удаляется; в preload проверяются типы входных параметров. Порт до renderer доходит цепочкой main → preload → `window.postMessage` (документация Electron «MessagePorts», проверка `event.source === window`); `contextBridge` порт не передаёт. Тип `Window.lms` объявляется в `src/vite-env.d.ts`. Перезагрузка окна = повторный `engine:connect`: старый порт закрывается, хост снимает подписку (`onClose`).

## 12. Безопасность

- `sandbox: true` явно; `contextIsolation` включён (по умолчанию, не отключать); `nodeIntegration: false`.
- Из main удаляется обработчик `open-win` (создаёт окно с `nodeIntegration: true, contextIsolation: false`).
- CSP в `index.html` ужесточается до `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'` (сейчас `script-src 'self' 'unsafe-inline'`); в dev Vite HMR требует исключений — отдельная CSP для dev **[ВЫВОД]**.
- Markdown курса санитизируется в UI (`engine-ts.md` §9: движок отдаёт сырой).
- Все аргументы RPC валидируются zod на хосте; `ipcMain` принимает только от `mainFrame`.
- Диалоги и остальное Electron-API — только в main.
- Загрузка страницы через собственный протокол вместо `file:` (совет Habr; в современном Electron — `protocol.handle`) сейчас не делается **[НЕ ПОДТВЕРЖДЕНО]** для Electron 44.
- Статьи 2021 года про CJS в main неактуальны: шаблон уже собирает ESM (`"type": "module"`, `index.mjs` у preload); ESM и нативные модули в `utilityProcess` проверены (API §9).

## 13. Отказы и жизненный цикл

Дополняет `engine-ts.md` §9, не повторяет.

| Событие | Что происходит |
|---|---|
| Хост упал | Супервизор перезапускает с backoff, окна получают новые порты, клиент повторяет идемпотентные вызовы один раз, остальные получают `ENGINE_CLOSED` |
| Хост падает более 5 раз за 60 с | Диалог ошибки и выход из приложения |
| Окно перезагружено | Новый порт, старый закрыт, слушатели сняты |
| Рассинхрон `CONTRACT_VERSION` | `engine.hello` возвращает `INCOMPATIBLE_CONTRACT`, `connectEngine` отклоняется, UI показывает экран «обновите приложение» |
| Выход из приложения | `before-quit` → `shutdown` хоста (очередь дренируется, раннеры и SQLite закрываются); по таймауту 5 с — `kill` |
| Сбой применения события к проекциям | Состояние `dirty`; повтор `recordAttempt` даёт `duplicate: true`; следующее чтение перестраивает проекции |
| Старт до `ready` | Окно запомнено, порт выдаётся по `ready` |

## 14. Что менять в `apps/desktop` при реализации

Не выполняется в этой задаче; список отличий от текущего шаблона.

- Удалить мост `window.ipcRenderer`, `src/demos/ipc.ts` и обработчик `open-win`.
- Добавить `sandbox: true` и `will-navigate`.
- Вход `electron/host/index.ts` в сборку: сначала проверить многовходовую форму `vite-plugin-electron` (массив входов), при неудаче собрать хост отдельным скриптом сборки **[НЕ ПОДТВЕРЖДЕНО]**.
- `electron-builder.json`: `asarUnpack` для `better-sqlite3` (N-API-prebuild, пересборка под Electron по дизайну §8 не нужна — проверить) **[НЕ ПОДТВЕРЖДЕНО]**.
- `tsconfig`: включить `shared/` в оба проекта; `Window.lms` — в `vite-env.d.ts`.
- Заменить заглушки `YourAppID`/`YourAppName`.

## 15. Что взято из статей

| Идея | Источник | Применение |
|---|---|---|
| Общий модуль типов сообщений | LogRocket | `@lms/engine-contract` и `RPC_METHODS` |
| Бэкенд в отдельном Node-процессе, не в main и не в скрытом renderer | LogRocket | `utilityProcess`-хост |
| Async request/response для коротких операций, события для долгих и для состояния UI | LogRocket | RPC и `subscribe` |
| UI не знает про Electron | LogRocket, dev.to | Renderer видит `LearningEngine` |
| Валидировать входящие сообщения, снимать слушателей, не использовать sync IPC, узкие каналы | LogRocket | zod, `onClose`, один порт вместо десятков каналов |
| `Delegate` поверх IPC | dev.to | `MessageEndpoint` и три адаптера |
| Инверсия управления для платформенного (`Files`) | dev.to | Порты движка и `Platform` |
| `Manager.register` и Electron-only менеджеры | dev.to | Шеллы main |
| Три вида кода | dev.to | §1 |
| Structured clone как ограничение | dev.to | DTO-only и `structuredClone` в in-process паре |
| Узкий preload, sandbox, CSP «запретить всё», диалоги только в main | Habr | §11–§12 |

Что не берём: `node-ipc` (LogRocket) — есть `MessagePort` и `utilityProcess`; React, Redux, Storybook — не наш стек; эмуляция двух процессов в одном для веб-версии — только как тестовый транспорт.

## 16. Не подтверждено и открыто

- `fork` раннера внутри `utilityProcess` Electron 44 (`engine-ts.md` §12.13).
- Многовходовая сборка хоста в `vite-plugin-electron`.
- Поведение `z.tuple` с необязательным хвостом в zod 4.6.5.
- `protocol.handle` вместо `file:` на Electron 44.
- Выбор папки библиотеки пользователем (сейчас `libraryRoot = userData/library`, `dataDir = userData/data`).
- Политика выбора `GradePolicy` (M5).
