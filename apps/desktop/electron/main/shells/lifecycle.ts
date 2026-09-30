import type { Supervisor } from '../supervisor.ts';
import type { Shell } from './types.ts';

export interface LifecycleShellDeps {
  app: {
    on(
      event: 'before-quit',
      listener: (event: { preventDefault(): void }) => void,
    ): unknown;
    quit(): void;
  };
  /** Порядок остановки: сначала движок, затем хост расширений. */
  supervisors: readonly Pick<Supervisor, 'stop'>[];
}

/** Выход из приложения: graceful-остановка хостов по очереди (каждый не дольше 5 с, затем kill). */
export const createLifecycleShell = ({
  app,
  supervisors,
}: LifecycleShellDeps): Shell => ({
  register: () => {
    let stopped = false;
    app.on('before-quit', (event) => {
      if (stopped) return;
      event.preventDefault();
      (async () => {
        for (const supervisor of supervisors) await supervisor.stop();
      })().finally(() => {
        stopped = true;
        app.quit();
      });
    });
  },
});
