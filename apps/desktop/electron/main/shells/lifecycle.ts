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
  supervisor: Pick<Supervisor, 'stop'>;
}

/** Выход из приложения: сначала graceful-остановка хоста (не дольше 5 с, затем kill). */
export const createLifecycleShell = ({
  app,
  supervisor,
}: LifecycleShellDeps): Shell => ({
  register: () => {
    let stopped = false;
    app.on('before-quit', (event) => {
      if (stopped) return;
      event.preventDefault();
      supervisor.stop().finally(() => {
        stopped = true;
        app.quit();
      });
    });
  },
});
