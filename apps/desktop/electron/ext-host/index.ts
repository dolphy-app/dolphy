import {
  createJsonLogger,
  createNodeFsCourseSource,
} from '@dolphy-app/engine/node';
import { fromNodePort } from '@dolphy-app/engine-rpc/host';
import { createExtensionRuntime } from '@dolphy-app/extension-host';
import type { ExtensionRuntime } from '@dolphy-app/extension-host';

/** Сообщения main → хост расширений (`process.parentPort`). */
type ExtHostMessage =
  | { type: 'init'; libraryRoot: string }
  | { type: 'connect' }
  | { type: 'shutdown' };

const { parentPort } = process;
const logger = createJsonLogger(process.stderr);
let runtime: ExtensionRuntime | null = null;

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'uncaught');
  process.exit(1); // супервизор поднимет хост заново
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});

const handle = async (
  message: ExtHostMessage,
  ports: Electron.MessagePortMain[],
) => {
  if (message.type === 'init') {
    const library = createNodeFsCourseSource(message.libraryRoot);
    // расширения хост не ищет: набор приходит от движка сообщением `replaceExtensions`
    // после каждого подключения порта
    runtime = createExtensionRuntime({
      extensions: [],
      library,
      logger,
    });
    parentPort.postMessage({ type: 'ready' });
  } else if (message.type === 'connect') {
    const [port] = ports;
    if (runtime && port) runtime.attach(fromNodePort(port));
  } else {
    await runtime?.dispose();
    process.exit(0);
  }
};

parentPort.on('message', ({ data, ports }) => {
  handle(data as ExtHostMessage, ports).catch((error) => {
    logger.error({ error }, 'extension host message failed');
    process.exit(1);
  });
});
