import { createRegistrar } from '../src/registrar.ts';
import { createSettingsState } from '../src/state.ts';
import { createLogger, nullEngine, nullLibrary } from './helpers.ts';

/** Регистратор расширения `id` с пустым движком и библиотекой. */
export const registrarOf = (id: string) => {
  const logger = createLogger();
  const settings = createSettingsState(id, logger);
  const registrar = createRegistrar({
    extensionId: id,
    logger,
    library: nullLibrary,
    engine: nullEngine,
    settings,
  });
  return { registrar, s: registrar.context, settings, logger };
};

export const run = async (): Promise<Record<string, never>> => ({});

/** Сообщение ошибки, которую бросает вызов; сам вызов обязан бросить. */
export const messageOf = (call: () => unknown): string => {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('registration was accepted');
};
