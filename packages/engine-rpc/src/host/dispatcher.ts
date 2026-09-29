import { EngineError } from '@lms/engine/app';
import type { Logger } from '@lms/engine/ports';
import {
  CONTRACT_VERSION,
  RPC_METHODS,
  type EngineErrorDto,
  type LearningEngine,
  type MessageEndpoint,
  type RpcMethodName,
  type RpcPush,
  type RpcRequest,
  type RpcResponse,
} from '@lms/engine-contract';
import * as z from 'zod';
import { assertSameKeys } from './assert-same-keys.ts';

type Handler = (...args: unknown[]) => Promise<unknown>;

interface ClientState {
  readonly clientId: string;
  readonly endpoint: MessageEndpoint;
  unsubscribe: (() => void) | null;
}

type ControlHandler = (client: ClientState, params: unknown[]) => unknown;

export interface DispatcherOptions {
  engine: LearningEngine;
  /** По схеме `z.tuple` на каждый ключ `RPC_METHODS`. */
  schemas: Readonly<Record<RpcMethodName, z.ZodType<unknown[]>>>;
  logger: Logger;
  /** Dev/тесты: `structuredClone(result)` перед отправкой, чтобы `DataCloneError` ловился рано. */
  verifyCloneable?: boolean;
}

export interface Dispatcher {
  attach(endpoint: MessageEndpoint, clientId: string): void;
  closeAll(): void;
}

const helloSchema = z.tuple([z.strictObject({ contractVersion: z.number() })]);
const noParamsSchema = z.tuple([]);

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** `undefined` в свойствах объектов не значим (схемы — `exactOptional`): убираем до разбора. */
const dropUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (typeof value !== 'object' || value === null) return value;
  if (!isPlainObject(value)) return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) cleaned[key] = dropUndefined(item);
  }
  return cleaned;
};

const normalizeParams = (params: unknown): unknown => {
  const list = params ?? [];
  if (!Array.isArray(list)) return list;
  const args = list.map(dropUndefined);
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
  return args;
};

const resolveHandler = (engine: LearningEngine, name: string): Handler => {
  const segments = name.split('.');
  let owner: unknown = engine;
  let target: unknown = engine;
  for (const segment of segments) {
    owner = target;
    if (typeof target !== 'object' || target === null) target = undefined;
    else target = Reflect.get(target, segment);
  }
  if (typeof target !== 'function') {
    throw new Error(`RPC method ${name} is missing in the engine`);
  }
  return (...args) => Reflect.apply(target, owner, args) as Promise<unknown>;
};

const isRequest = (message: unknown): message is RpcRequest =>
  typeof message === 'object' &&
  message !== null &&
  typeof Reflect.get(message, 'id') === 'string';

export const createDispatcher = ({
  engine,
  schemas,
  logger,
  verifyCloneable = false,
}: DispatcherOptions): Dispatcher => {
  assertSameKeys(Object.keys(RPC_METHODS), Object.keys(schemas));
  const handlers = new Map<string, Handler>();
  for (const name of Object.keys(RPC_METHODS)) {
    handlers.set(name, resolveHandler(engine, name));
  }
  const schemaByMethod = new Map<string, z.ZodType<unknown[]>>(
    Object.entries(schemas),
  );
  const clients = new Map<string, ClientState>();

  const invalidArgument = (method: string, error: z.ZodError): EngineError => {
    const issues = error.issues.map(({ path, message }) => ({ path, message }));
    return new EngineError('INVALID_ARGUMENT', { details: { method, issues } });
  };

  const parseParams = <T extends unknown[]>(
    method: string,
    schema: z.ZodType<T>,
    params: unknown,
  ): T => {
    const parsed = schema.safeParse(normalizeParams(params)); // renderer — недоверенный вход
    if (!parsed.success) throw invalidArgument(method, parsed.error);
    return parsed.data;
  };

  const send = (
    endpoint: MessageEndpoint,
    message: RpcResponse | RpcPush,
    method: string,
  ): void => {
    try {
      endpoint.post(message);
    } catch (error) {
      logger.error({ error, method }, 'failed to post message');
      if ('id' in message && message.ok) {
        endpoint.post({
          id: message.id,
          ok: false,
          error: new EngineError('INTERNAL', {
            details: { method, cause: 'not-cloneable' },
          }).toDto(),
        });
      }
    }
  };

  const control: Record<string, ControlHandler> = {
    'engine.hello': async (_client, params) => {
      const [hello] = parseParams('engine.hello', helloSchema, params);
      if (hello.contractVersion !== CONTRACT_VERSION) {
        throw new EngineError('INCOMPATIBLE_CONTRACT', {
          details: { host: CONTRACT_VERSION, client: hello.contractVersion },
        });
      }
      const { engineVersion } = await engine.diagnostics();
      return { contractVersion: CONTRACT_VERSION, engineVersion };
    },
    'events.subscribe': (client, params) => {
      parseParams('events.subscribe', noParamsSchema, params);
      client.unsubscribe ??= engine.subscribe((event) => {
        send(client.endpoint, { event }, 'events.push');
      });
      return null;
    },
    'events.unsubscribe': (client, params) => {
      parseParams('events.unsubscribe', noParamsSchema, params);
      client.unsubscribe?.();
      client.unsubscribe = null;
      return null;
    },
  };
  const controlByName = new Map(Object.entries(control));

  const toErrorDto = (error: unknown, method: string): EngineErrorDto => {
    if (error instanceof EngineError) return error.toDto();
    logger.error({ error, method }, 'dispatcher failure'); // движок уже маппит ошибки
    return new EngineError('INTERNAL').toDto();
  };

  const execute = async (
    client: ClientState,
    { method, params }: RpcRequest,
  ): Promise<unknown> => {
    if (typeof method !== 'string') {
      throw new EngineError('INVALID_ARGUMENT', { details: { method } });
    }
    const controlHandler = controlByName.get(method);
    if (controlHandler) return controlHandler(client, params as unknown[]);
    const schema = schemaByMethod.get(method);
    const handler = handlers.get(method);
    if (!schema || !handler) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: { method, reason: 'unknown-method' },
      });
    }
    const args = parseParams(method, schema, params);
    const result = await handler(...args);
    if (verifyCloneable) structuredClone(result);
    return result;
  };

  const handle = async (
    client: ClientState,
    request: RpcRequest,
  ): Promise<RpcResponse> => {
    const { id } = request;
    try {
      return { id, ok: true, result: await execute(client, request) };
    } catch (error) {
      return {
        id,
        ok: false,
        error: toErrorDto(error, String(request.method)),
      };
    }
  };

  const attach = (endpoint: MessageEndpoint, clientId: string): void => {
    const previous = clients.get(clientId);
    const client: ClientState = { clientId, endpoint, unsubscribe: null };
    clients.set(clientId, client);
    if (previous) {
      previous.unsubscribe?.();
      previous.endpoint.close(); // один порт на клиента
    }
    endpoint.onMessage((message) => {
      if (!isRequest(message)) {
        logger.warn({ clientId }, 'malformed rpc message dropped');
        return;
      }
      void handle(client, message).then((response) => {
        send(endpoint, response, String(message.method));
      });
    });
    endpoint.onClose(() => {
      client.unsubscribe?.(); // снять слушателя: утечки нет
      client.unsubscribe = null;
      if (clients.get(clientId) === client) clients.delete(clientId);
    });
  };

  const closeAll = (): void => {
    for (const { endpoint } of [...clients.values()]) endpoint.close();
  };

  return { attach, closeAll };
};
