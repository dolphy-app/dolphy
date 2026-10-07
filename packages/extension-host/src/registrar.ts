import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import {
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_RPC_LIMITS,
  EXTENSION_SCHEDULE_LIMITS,
  EXTENSION_TRANSFER_LIMITS,
  LEARNING_EVENT_NAMES,
  RPC_NAME_PATTERN,
  SCHEDULE_AT_PATTERN,
  TRANSFER_ACCEPT_PATTERN,
} from '@dolphy-app/extension-api';
import type {
  CommandHandler,
  Disposable,
  ExerciseTypeHandler,
  ExporterHandler,
  ExtensionLogger,
  GradePolicyHandler,
  ImporterHandler,
  JsonSchema,
  LearningEventName,
  LibraryReader,
  RegisteredCommand,
  RegisteredExerciseType,
  RegisteredExporter,
  RegisteredGradePolicy,
  RegisteredImporter,
  RegisteredSchedule,
  RegisteredSetting,
  RpcContract,
  ScheduleHandler,
  ServerContext,
  ServerRegistration,
  SettingValues,
} from '@dolphy-app/extension-api';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { z } from 'zod';
import type { EngineLink } from './engine-link.ts';
import { registerCommandMetadata } from './registrar-commands.ts';
import { registerSettingDefinitions } from './registrar-settings.ts';
import {
  RegistrationError,
  functionField,
  idField,
  localizedField,
  ownIdIssue,
  parseRegistration,
  schemaIssues,
} from './registrar-support.ts';
import {
  createExtensionNotifications,
  createExtensionSecrets,
  createExtensionStats,
  createExtensionStorage,
} from './state.ts';
import type { SettingsState } from './state.ts';

const BUILTIN_POLICY_ID = 'passAtN';
const { titleLength } = EXTENSION_COMMAND_LIMITS;

const schemaField = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length > 0, 'must not be empty');

const exerciseTypeSchema = z.strictObject({
  id: idField,
  title: localizedField(titleLength).optional(),
  specSchema: schemaField,
  answerSchema: schemaField,
  project: functionField,
  grade: functionField,
  referenceAnswer: functionField.optional(),
});

const gradePolicySchema = z.strictObject({
  id: idField.refine(
    (id) => id !== BUILTIN_POLICY_ID,
    `id '${BUILTIN_POLICY_ID}' is reserved for the built-in policy`,
  ),
  label: localizedField(titleLength),
  evaluate: functionField,
});

const scheduleSchema = z.discriminatedUnion('every', [
  z.strictObject({
    id: idField,
    every: z.literal('daily'),
    at: z.string().regex(SCHEDULE_AT_PATTERN, "must be a time such as '09:00'"),
  }),
  z.strictObject({ id: idField, every: z.literal('hourly') }),
]);

const importerSchema = z.strictObject({
  id: idField,
  title: localizedField(titleLength),
  accept: z
    .array(
      z
        .string()
        .regex(
          TRANSFER_ACCEPT_PATTERN,
          "must be a lower-case file extension such as '.csv'",
        ),
    )
    .min(1)
    .max(EXTENSION_TRANSFER_LIMITS.acceptExtensions),
  input: z.enum(['text', 'bytes']),
  run: functionField,
});

const exporterSchema = z.strictObject({
  id: idField,
  title: localizedField(titleLength),
  scope: z.enum(['course', 'progress']),
  run: functionField,
});

const schemaLike = z.custom<RpcContract<unknown, unknown>['input']>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'safeParseAsync') === 'function',
  'must be a zod schema',
);

const rpcSchema = z.object({
  name: z
    .string()
    .max(EXTENSION_RPC_LIMITS.nameLength)
    .regex(RPC_NAME_PATTERN, 'must match RPC_NAME_PATTERN'),
  input: schemaLike,
  output: schemaLike,
});

type RpcHandler = (input: unknown) => unknown;

/** Контракт RPC и его обработчик: схемы остаются в хосте, наружу уходит только имя. */
export interface RpcEntry {
  contract: RpcContract<unknown, unknown>;
  handler: RpcHandler;
}

/** Зарегистрированный вклад: метаданные для снимка и обработчик, который остаётся в хосте. */
interface Entry<Meta, Handler> {
  meta: Meta;
  handler: Handler;
}

type EventHandler = (payload: unknown) => void | Promise<void>;

/** Обработчики расширения, найденные по идентификатору вклада. */
export interface ServerHandlers {
  exerciseTypes: Map<
    string,
    Entry<RegisteredExerciseType, ExerciseTypeHandler>
  >;
  gradePolicies: Map<string, Entry<RegisteredGradePolicy, GradePolicyHandler>>;
  rpcs: Map<string, RpcEntry>;
  events: Map<LearningEventName, EventHandler>;
  commands: Map<string, Entry<RegisteredCommand, CommandHandler>>;
  schedules: Map<string, Entry<RegisteredSchedule, ScheduleHandler>>;
  importers: Map<string, Entry<RegisteredImporter, ImporterHandler>>;
  exporters: Map<string, Entry<RegisteredExporter, ExporterHandler>>;
}

export interface RegistrarOptions {
  extensionId: string;
  /** Логгер расширения (поле `extensionId` уже проставлено). */
  logger: ExtensionLogger;
  library: LibraryReader;
  engine: EngineLink;
  /** Клиент движка расширения: `server.engine`. */
  engineClient: ExtensionEngine;
  settings: SettingsState;
}

export interface Registrar {
  /** То, что получает `server(s)`. */
  readonly context: ServerContext<SettingValues, ExtensionEngine>;
  readonly handlers: ServerHandlers;
  /** После вызова регистрации бросают: `server` закончил, вклады больше не меняются. */
  seal(): void;
  /** Сериализуемый снимок текущих регистраций: порядок — порядок вызовов. */
  snapshot(): ServerRegistration;
}

const inOrder = <Meta>(
  entries: ReadonlyMap<string, Entry<Meta, unknown>>,
): Meta[] => [...entries.values()].map(({ meta }) => meta);

export const createRegistrar = (options: RegistrarOptions): Registrar => {
  const { extensionId: owner, engine, settings } = options;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const handlers: ServerHandlers = {
    exerciseTypes: new Map(),
    gradePolicies: new Map(),
    rpcs: new Map(),
    events: new Map(),
    commands: new Map(),
    schedules: new Map(),
    importers: new Map(),
    exporters: new Map(),
  };
  const registeredSettings: RegisteredSetting[] = [];
  let sealed = false;

  const open = (kind: string): void => {
    if (sealed) {
      throw new RegistrationError(kind, undefined, [
        'server() has already finished; register contributions before it returns',
      ]);
    }
  };

  const claim = <Meta extends { id: string }, Handler>(
    kind: string,
    map: Map<string, Entry<Meta, Handler>>,
    meta: Meta,
    handler: Handler,
    limit?: number,
  ): Disposable => {
    const issues = ownIdIssue(meta.id, owner);
    if (map.has(meta.id)) issues.push(`duplicate ${kind} '${meta.id}'`);
    if (limit !== undefined && map.size >= limit) {
      issues.push(`at most ${limit} ${kind}s allowed`);
    }
    if (issues.length > 0) throw new RegistrationError(kind, meta.id, issues);
    const entry = { meta, handler };
    map.set(meta.id, entry);
    return {
      dispose: () => {
        if (map.get(meta.id) === entry) map.delete(meta.id);
      },
    };
  };

  const compile = (schema: JsonSchema, label: string): JsonSchema => {
    try {
      const copy = structuredClone(schema);
      ajv.compile(copy);
      return copy;
    } catch (error) {
      throw new RegistrationError('exercise type', undefined, [
        `${label} is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  };

  const context: ServerContext<SettingValues, ExtensionEngine> = {
    extensionId: owner,
    logger: options.logger,
    library: options.library,
    storage: createExtensionStorage(engine, owner),
    stats: createExtensionStats(engine, owner),
    secrets: createExtensionSecrets(engine, owner),
    notifications: createExtensionNotifications(engine, owner),
    engine: options.engineClient,
    settings: settings.api,

    registerExerciseType(reg) {
      open('exercise type');
      const parsed = parseRegistration(
        'exercise type',
        exerciseTypeSchema,
        reg,
      );
      const meta: RegisteredExerciseType = {
        id: parsed.id,
        title: parsed.title ?? null,
        specSchema: compile(reg.specSchema, `specSchema of '${parsed.id}'`),
        answerSchema: compile(
          reg.answerSchema,
          `answerSchema of '${parsed.id}'`,
        ),
      };
      return claim('exercise type', handlers.exerciseTypes, meta, reg);
    },

    registerGradePolicy(reg) {
      open('grade policy');
      const parsed = parseRegistration('grade policy', gradePolicySchema, reg);
      return claim(
        'grade policy',
        handlers.gradePolicies,
        { id: parsed.id, label: parsed.label },
        reg.evaluate,
      );
    },

    registerSettings(defs) {
      open('setting');
      const added = registerSettingDefinitions(defs, owner, registeredSettings);
      registeredSettings.push(...added);
      settings.define(added);
      return {
        dispose: () => {
          const ids = new Set(added.map(({ id }) => id));
          for (let index = registeredSettings.length - 1; index >= 0; index--) {
            if (ids.has(registeredSettings[index]?.id ?? '')) {
              registeredSettings.splice(index, 1);
            }
          }
          settings.undefine([...ids]);
        },
      };
    },

    on(event, handler) {
      open('event');
      if (!LEARNING_EVENT_NAMES.includes(event)) {
        throw new RegistrationError('event', event, ['unknown learning event']);
      }
      if (typeof handler !== 'function') {
        throw new RegistrationError('event', event, [
          'handler must be a function',
        ]);
      }
      if (handlers.events.has(event)) {
        throw new RegistrationError('event', event, [
          'event is already subscribed',
        ]);
      }
      const stored = handler as EventHandler;
      handlers.events.set(event, stored);
      return {
        dispose: () => {
          if (handlers.events.get(event) === stored)
            handlers.events.delete(event);
        },
      };
    },

    registerCommand(reg) {
      open('command');
      return claim(
        'command',
        handlers.commands,
        registerCommandMetadata(reg, owner),
        reg.run,
        EXTENSION_COMMAND_LIMITS.commands,
      );
    },

    schedule(reg, handler) {
      open('schedule');
      const parsed = parseRegistration('schedule', scheduleSchema, reg);
      if (typeof handler !== 'function') {
        throw new RegistrationError('schedule', parsed.id, [
          'handler must be a function',
        ]);
      }
      return claim(
        'schedule',
        handlers.schedules,
        {
          id: parsed.id,
          every: parsed.every,
          at: parsed.every === 'daily' ? parsed.at : null,
        },
        handler,
        EXTENSION_SCHEDULE_LIMITS.schedules,
      );
    },

    registerImporter(reg) {
      open('importer');
      const parsed = parseRegistration('importer', importerSchema, reg);
      const repeated = parsed.accept.filter(
        (extension, index) => parsed.accept.indexOf(extension) !== index,
      );
      if (repeated.length > 0) {
        throw new RegistrationError('importer', parsed.id, [
          `duplicate accept extension '${repeated[0]}'`,
        ]);
      }
      return claim(
        'importer',
        handlers.importers,
        {
          id: parsed.id,
          title: parsed.title,
          accept: [...parsed.accept],
          input: parsed.input,
        },
        reg.run,
        EXTENSION_TRANSFER_LIMITS.importers,
      );
    },

    registerExporter(reg) {
      open('exporter');
      const parsed = parseRegistration('exporter', exporterSchema, reg);
      return claim(
        'exporter',
        handlers.exporters,
        { id: parsed.id, title: parsed.title, scope: parsed.scope },
        reg.run,
        EXTENSION_TRANSFER_LIMITS.exporters,
      );
    },

    handle(contract, handler) {
      open('rpc');
      const parsed = rpcSchema.safeParse(contract);
      const issues = parsed.success ? [] : schemaIssues(parsed.error);
      if (typeof handler !== 'function')
        issues.push('handler must be a function');
      const name = parsed.success ? parsed.data.name : undefined;
      if (name !== undefined) {
        if (handlers.rpcs.has(name)) issues.push(`duplicate rpc '${name}'`);
        if (handlers.rpcs.size >= EXTENSION_RPC_LIMITS.rpcs) {
          issues.push(`at most ${EXTENSION_RPC_LIMITS.rpcs} rpcs allowed`);
        }
      }
      if (!parsed.success || name === undefined || issues.length > 0) {
        throw new RegistrationError('rpc', name, issues);
      }
      const entry: RpcEntry = {
        contract: parsed.data,
        handler: handler as RpcHandler,
      };
      handlers.rpcs.set(name, entry);
      return {
        dispose: () => {
          if (handlers.rpcs.get(name) === entry) handlers.rpcs.delete(name);
        },
      };
    },
  };

  return {
    context,
    handlers,
    seal: () => {
      sealed = true;
    },
    snapshot: () => ({
      exerciseTypes: inOrder(handlers.exerciseTypes),
      gradePolicies: inOrder(handlers.gradePolicies),
      settings: [...registeredSettings],
      events: [...handlers.events.keys()],
      commands: inOrder(handlers.commands),
      schedules: inOrder(handlers.schedules),
      importers: inOrder(handlers.importers),
      exporters: inOrder(handlers.exporters),
      rpcs: [...handlers.rpcs.keys()],
    }),
  };
};
