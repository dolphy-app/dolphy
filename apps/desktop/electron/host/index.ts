import { createDispatcher, fromNodePort, schemas } from '@lms/engine-rpc/host';
import type { Dispatcher } from '@lms/engine-rpc/host';
import type { RemoteExerciseTypes } from '@lms/extension-host';
import type { EngineConfig, LearningEngine } from '@lms/engine-contract';
import { boot } from './boot.ts';

/** Сообщения main → хост (`process.parentPort`). */
type HostMessage =
  | { type: 'init'; config: EngineConfig }
  | { type: 'connect'; clientId: string }
  | { type: 'ext-port' }
  | { type: 'shutdown' };

const { parentPort } = process;
let engine: LearningEngine | null = null;
let dispatcher: Dispatcher | null = null;
let exerciseTypes: RemoteExerciseTypes | null = null;

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

const handle = async (
  message: HostMessage,
  ports: Electron.MessagePortMain[],
) => {
  if (message.type === 'init') {
    const booted = await boot(message.config, () =>
      parentPort.postMessage({ type: 'restart-ext-host' }),
    );
    engine = booted.engine;
    exerciseTypes = booted.exerciseTypes;
    dispatcher = createDispatcher({
      engine: booted.engine,
      schemas,
      logger: booted.logger,
    });
    parentPort.postMessage({
      type: 'ready',
      node: process.versions.node,
      electron: process.versions.electron,
    });
  } else if (message.type === 'connect') {
    const [port] = ports;
    if (dispatcher && port) {
      dispatcher.attach(fromNodePort(port), message.clientId);
    }
  } else if (message.type === 'ext-port') {
    const [port] = ports;
    if (exerciseTypes && port) exerciseTypes.attach(fromNodePort(port));
  } else {
    await shutdown();
  }
};

parentPort.on('message', ({ data, ports }) => {
  handle(data as HostMessage, ports).catch((error) => {
    console.error({ error }, 'host message failed');
    process.exit(1);
  });
});
