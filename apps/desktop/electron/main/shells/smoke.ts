import { SMOKE_CHANNELS } from '../../../shared/smoke.ts';
import type { MainLogger } from '../logger.ts';
import type { Supervisor } from '../supervisor.ts';
import type { EngineConnectEvent } from './engine.ts';
import type { Shell } from './types.ts';

export const SMOKE_RESULT_PREFIX = 'DOLPHY_SMOKE_RESULT ';
export const SMOKE_TIMEOUT_MS = 90_000;

export interface SmokeShellDeps {
  ipcMain: {
    on(
      channel: string,
      listener: (event: EngineConnectEvent, result: unknown) => void,
    ): unknown;
    handle(
      channel: string,
      listener: (event: EngineConnectEvent) => boolean,
    ): unknown;
  };
  app: { exit(code: number): void };
  supervisor: Pick<Supervisor, 'stop' | 'kill'>;
  logger: MainLogger;
  versions: NodeJS.ProcessVersions;
  /** `app.isPackaged`: скрипт сверяет с ожидаемым режимом запуска. */
  packaged: boolean;
  print(line: string): void;
  timeoutMs?: number;
}

const isPassed = (result: unknown): boolean =>
  typeof result === 'object' &&
  result !== null &&
  (result as { ok?: unknown }).ok === true;

/**
 * Только в смоук-сборке (`DOLPHY_SMOKE_BUILD=1`) при `DOLPHY_SMOKE=1`: renderer сообщает итог
 * сквозной проверки, main печатает его в stdout, останавливает хост и выходит.
 */
export const createSmokeShell = (deps: SmokeShellDeps): Shell => ({
  register: () => {
    const { ipcMain, app, supervisor, logger } = deps;
    let finished = false;

    const finish = async (result: unknown) => {
      if (finished) return;
      finished = true;
      const payload = {
        versions: deps.versions,
        packaged: deps.packaged,
        result,
      };
      deps.print(`${SMOKE_RESULT_PREFIX}${JSON.stringify(payload)}`);
      await supervisor.stop();
      app.exit(isPassed(result) ? 0 : 1);
    };

    const watchdog = setTimeout(() => {
      logger.error({}, 'smoke timed out');
      finish({ ok: false, error: 'smoke timed out' }).catch(() => {
        app.exit(1);
      });
    }, deps.timeoutMs ?? SMOKE_TIMEOUT_MS);
    watchdog.unref();

    const trusted = (event: EngineConnectEvent) =>
      event.senderFrame === event.sender.mainFrame;

    ipcMain.on(SMOKE_CHANNELS.report, (event, result) => {
      if (!trusted(event)) return;
      finish(result).catch((error) => {
        logger.error({ error }, 'smoke finish failed');
        app.exit(1);
      });
    });
    ipcMain.handle(SMOKE_CHANNELS.killHost, (event) =>
      trusted(event) ? supervisor.kill() : false,
    );
  },
});
