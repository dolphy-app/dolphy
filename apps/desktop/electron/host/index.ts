import {
  createDispatcher,
  fromNodePort,
  schemas,
} from '@dolphy-app/engine-rpc/host';
import type { Dispatcher } from '@dolphy-app/engine-rpc/host';
import type { HostedEngine } from '@dolphy-app/engine/app';
import type { HostChannel } from '@dolphy-app/extension-host';
import type {
  EngineConfig,
  ExtensionHostStatusDto,
} from '@dolphy-app/engine-contract';
import type { ExtensionHealth } from '@dolphy-app/engine/ports';
import { boot } from './boot.ts';
import { createHostPlatform } from './platform.ts';

/** Сообщения main → хост (`process.parentPort`). */
type HostMessage =
  | { type: 'init'; config: EngineConfig }
  | { type: 'connect'; clientId: string }
  | { type: 'ext-port' }
  | { type: 'reload-extensions' }
  | { type: 'ext-host-status'; status: ExtensionHostStatusDto }
  | { type: 'shutdown' };

const { parentPort } = process;
// запросы к main за возможностями платформы (шифр секретов): ответы приходят в `handle`
const platform = createHostPlatform({
  post: (message) => parentPort.postMessage(message),
});
let engine: HostedEngine | null = null;
let dispatcher: Dispatcher | null = null;
let channel: HostChannel | null = null;
let health: ExtensionHealth | null = null;

process.on('uncaughtException', (error) => {
  console.error({ error }, 'uncaught'); // состояние могло испортиться
  process.exit(1); // супервизор поднимет хост заново
});
process.on('unhandledRejection', (reason) => {
  console.error({ reason }, 'unhandled rejection'); // баг: исправлять
});

const shutdown = async () => {
  dispatcher?.closeAll(); // перестать принимать вызовы
  platform.close(); // ожидающие запросы к main отклоняются
  await engine?.close(); // дождаться очереди, закрыть раннеры и SQLite
  process.exit(0);
};

const handle = async (
  message: HostMessage,
  ports: Electron.MessagePortMain[],
) => {
  if (platform.handleMessage(message)) return;
  if (message.type === 'init') {
    const booted = await boot(
      message.config,
      () => parentPort.postMessage({ type: 'restart-ext-host' }),
      () => parentPort.postMessage({ type: 'reset-ext-host' }),
      platform.services,
      (opened) => {
        channel = opened;
        parentPort.postMessage({ type: 'ext-link' });
      },
    );
    engine = booted.engine;
    health = booted.health;
    dispatcher = createDispatcher({
      engine: booted.engine,
      schemas,
      logger: booted.logger,
    });
    // расширения вызывают методы движка кадрами внутри канала хоста: каждое — клиентом `extension:<id>`
    booted.channel.serveEngine(dispatcher);
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
    if (channel && port) channel.attach(fromNodePort(port));
  } else if (message.type === 'reload-extensions') {
    // правка в режиме разработчика: применить без перезапуска; ошибки логирует сам движок
    await engine?.reloadExtensions();
  } else if (message.type === 'ext-host-status') {
    // main следит за процессом хоста расширений и сообщает его состояние
    health?.setHostStatus(message.status);
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
