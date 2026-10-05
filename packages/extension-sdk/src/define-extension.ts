import type {
  CommandHandler,
  Disposable,
  ExerciseTypeHandler,
  ExporterHandler,
  ExtensionContext as ApiExtensionContext,
  ExtensionModule,
  GradePolicyHandler,
  ImporterHandler,
  LearningEventHandler,
  LearningEventName,
  ScheduleHandler,
} from '@dolphy-app/extension-api';
import type { ExtensionContext, HasGeneratedIds, ResolvedIds } from './ids.ts';

declare const inActivateBrand: unique symbol;

/** Type of `inActivate`. */
export interface InActivate {
  readonly [inActivateBrand]: true;
}

/**
 * A record value in `defineExtension` that says "this id is registered in
 * `activate`" (`ctx.commands.register`, `ctx.events.on`,
 * `ctx.importers.register`, `ctx.exporters.register`, `ctx.schedule.on`,
 * `ctx.registerExerciseType`, `ctx.registerGradePolicy`) rather than by a
 * handler in the record. Needed because the records must name every declared
 * id: a handler that needs `ctx` is written in `activate`, and its id gets this
 * marker in the record.
 */
export const inActivate = /*#__PURE__*/ Object.freeze({}) as InActivate;

/** Without generated declarations a record may name any subset: an index signature already does, a record keyed by the event names needs `Partial`. */
type Lenient<Entries> = string extends keyof Entries
  ? Entries
  : Partial<Entries>;

/**
 * The definition record of one kind of id. With generated declarations the
 * record is required (when the manifest declares any id of the kind) and holds
 * exactly the declared ids: a missing and an extra key are compile errors.
 * Without them every key is accepted and the record is optional.
 */
type Section<Name extends string, Id extends string, Entries> = [
  HasGeneratedIds,
] extends [false]
  ? { readonly [N in Name]?: Lenient<Entries> }
  : [Id] extends [never]
    ? { readonly [N in Name]?: never }
    : { readonly [N in Name]: Entries };

type Ids = ResolvedIds;

/** Learning-event handlers by event name; the events must be declared in `contributes.events`, the `learning.events` permission is needed. */
export type EventHandlers = {
  readonly [N in Ids['events']]: LearningEventHandler<N> | InActivate;
};

/**
 * What `defineExtension` takes. `exerciseTypes`, `gradePolicies`, `events`,
 * `commands`, `schedules`, `importers` and `exporters` name every id
 * `extension.json` declares for them, exactly: a handler, or `inActivate` for
 * an id that `activate` registers.
 */
export type ExtensionDefinition = Section<
  'exerciseTypes',
  Ids['exerciseTypes'],
  { readonly [K in Ids['exerciseTypes']]: ExerciseTypeHandler | InActivate }
> &
  Section<
    'gradePolicies',
    Ids['gradePolicies'],
    { readonly [K in Ids['gradePolicies']]: GradePolicyHandler | InActivate }
  > &
  Section<'events', Ids['events'], EventHandlers> &
  Section<
    'commands',
    Ids['commands'],
    { readonly [K in Ids['commands']]: CommandHandler | InActivate }
  > &
  Section<
    'schedules',
    Ids['schedules'],
    { readonly [K in Ids['schedules']]: ScheduleHandler | InActivate }
  > &
  Section<
    'importers',
    Ids['importers'],
    { readonly [K in Ids['importers']]: ImporterHandler | InActivate }
  > &
  Section<
    'exporters',
    Ids['exporters'],
    { readonly [K in Ids['exporters']]: ExporterHandler | InActivate }
  > & {
    /** Runs after the records are registered. */
    activate?(context: ExtensionContext): void | Promise<void>;
    deactivate?(): void | Promise<void>;
  };

/*#__NO_SIDE_EFFECTS__*/
export const defineExerciseType = <Spec, Answer, View>(
  handler: ExerciseTypeHandler<Spec, Answer, View>,
): ExerciseTypeHandler<Spec, Answer, View> => handler;

const disposeInReverse = async (
  registrations: Disposable[],
): Promise<unknown[]> => {
  const errors: unknown[] = [];
  for (const registration of registrations.splice(0).reverse()) {
    try {
      await registration.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
};

/**
 * The definition as the runtime sees it: the types above only narrow the keys
 * to the declared ids, which the host checks again when it registers them.
 */
interface LooseDefinition {
  exerciseTypes?: Readonly<Record<string, ExerciseTypeHandler | InActivate>>;
  gradePolicies?: Readonly<Record<string, GradePolicyHandler | InActivate>>;
  events?: Readonly<
    Partial<Record<LearningEventName, LearningEventHandler<never> | InActivate>>
  >;
  commands?: Readonly<Record<string, CommandHandler | InActivate>>;
  schedules?: Readonly<Record<string, ScheduleHandler | InActivate>>;
  importers?: Readonly<Record<string, ImporterHandler | InActivate>>;
  exporters?: Readonly<Record<string, ExporterHandler | InActivate>>;
  activate?(context: ApiExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** The entries of a record that carry a handler (not `inActivate`). */
const handlersOf = <T>(
  record: Readonly<Record<string, T | InActivate>> | undefined,
): [string, T][] =>
  Object.entries(record ?? {}).filter(
    (entry): entry is [string, T] => entry[1] !== inActivate,
  );

/*#__NO_SIDE_EFFECTS__*/
export const defineExtension = (
  declared: ExtensionDefinition,
): ExtensionModule => {
  // the declared-ids types depend on the program that includes the generated
  // declarations; the runtime needs only the loose shape
  const definition = declared as unknown as LooseDefinition;
  const registrations: Disposable[] = [];

  const register = (context: ApiExtensionContext) => {
    for (const [type, handler] of handlersOf(definition.exerciseTypes)) {
      registrations.push(context.registerExerciseType(type, handler));
    }
    for (const [id, handler] of handlersOf(definition.gradePolicies)) {
      registrations.push(context.registerGradePolicy(id, handler));
    }
    for (const [name, handler] of handlersOf(definition.events)) {
      registrations.push(
        context.events.on(
          name as LearningEventName,
          handler as LearningEventHandler<LearningEventName>,
        ),
      );
    }
    for (const [id, handler] of handlersOf(definition.commands)) {
      registrations.push(context.commands.register(id, handler));
    }
    for (const [id, handler] of handlersOf(definition.schedules)) {
      registrations.push(context.schedule.on(id, handler));
    }
    for (const [id, handler] of handlersOf(definition.importers)) {
      registrations.push(context.importers.register(id, handler));
    }
    for (const [id, handler] of handlersOf(definition.exporters)) {
      registrations.push(context.exporters.register(id, handler));
    }
  };

  const activate = async (context: ApiExtensionContext) => {
    try {
      register(context);
      await definition.activate?.(context);
    } catch (error) {
      const disposalErrors = await disposeInReverse(registrations);
      if (disposalErrors.length === 0) throw error;
      throw new AggregateError(
        [error, ...disposalErrors],
        'activation failed and rollback was incomplete',
      );
    }
  };

  const deactivate = async () => {
    const failures: unknown[] = [];
    try {
      await definition.deactivate?.();
    } catch (error) {
      failures.push(error);
    }
    const disposalErrors = await disposeInReverse(registrations);
    if (disposalErrors.length > 0) {
      failures.push(
        new AggregateError(disposalErrors, 'failed to dispose contributions'),
      );
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'failed to deactivate extension');
    }
  };

  return { activate, deactivate };
};
