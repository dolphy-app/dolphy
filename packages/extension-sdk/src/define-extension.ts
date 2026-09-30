import type {
  Disposable,
  ExerciseTypeHandler,
  ExtensionContext,
  ExtensionModule,
  GradePolicyHandler,
} from '@dolphy-app/extension-api';

export interface ExtensionDefinition {
  exerciseTypes?: Readonly<Record<string, ExerciseTypeHandler>>;
  gradePolicies?: Readonly<Record<string, GradePolicyHandler>>;
  /** Вызывается после регистрации `exerciseTypes` и `gradePolicies`. */
  activate?(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

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

export const defineExtension = (
  definition: ExtensionDefinition,
): ExtensionModule => {
  const registrations: Disposable[] = [];

  const register = (context: ExtensionContext) => {
    const entries = Object.entries(definition.exerciseTypes ?? {});
    for (const [type, handler] of entries) {
      registrations.push(context.registerExerciseType(type, handler));
    }
    for (const [id, handler] of Object.entries(
      definition.gradePolicies ?? {},
    )) {
      registrations.push(context.registerGradePolicy(id, handler));
    }
  };

  const activate = async (context: ExtensionContext) => {
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
