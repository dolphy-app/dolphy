import { expectTypeOf, test } from 'vitest';
import type {
  LearningEngine,
  LogEntryDto,
  RecordAttemptRequest,
  ResolveConflictRequest,
  RpcMethodName,
  RpcRequest,
  SyncConflictDto,
} from '../src/index.ts';

type Callable = (...args: never[]) => unknown;

type MethodPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Callable
    ? `${Prefix}${K}`
    : T[K] extends object
      ? MethodPaths<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

type Path<T, K extends string> = K extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? Path<T[Head], Tail>
    : never
  : K extends keyof T
    ? T[K]
    : never;

type ArgsOf<K extends RpcMethodName> =
  Path<LearningEngine, K> extends (...args: infer A) => unknown ? A : never;

type MethodsWithoutArgs = {
  [K in RpcMethodName]: [ArgsOf<K>] extends [never] ? K : never;
}[RpcMethodName];

// `subscribe` заменён служебными сообщениями RPC_CONTROL, `close` по RPC нет.
type EngineMethodName = Exclude<
  MethodPaths<LearningEngine>,
  'subscribe' | 'close'
>;

test('RPC_METHODS содержит ровно методы LearningEngine', () => {
  expectTypeOf<RpcMethodName>().toEqualTypeOf<EngineMethodName>();
});

test('каждый ключ RPC_METHODS указывает на метод движка', () => {
  expectTypeOf<ArgsOf<'practice.recordAttempt'>>().toEqualTypeOf<
    [RecordAttemptRequest]
  >();
  expectTypeOf<ArgsOf<'library.getInfo'>>().toEqualTypeOf<[]>();
  expectTypeOf<MethodsWithoutArgs>().toBeNever();
});

test('RpcRequest.method принимает строку, params — позиционные аргументы', () => {
  expectTypeOf<RpcRequest['method']>().toEqualTypeOf<string>();
  expectTypeOf<RpcRequest['params']>().toEqualTypeOf<unknown>();
});

test('SyncConflictDto: entryHashes добавлено рядом с неизменным entries', () => {
  expectTypeOf<SyncConflictDto['entries']>().toEqualTypeOf<LogEntryDto[]>();
  expectTypeOf<SyncConflictDto['entryHashes']>().toEqualTypeOf<string[]>();
  expectTypeOf<ResolveConflictRequest['keep']>().toEqualTypeOf<string>();
});
