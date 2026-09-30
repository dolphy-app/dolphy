import {
  createJsonLogger,
  createNodeFsCourseSource,
} from '@spirula/engine/node';
import { fromNodePort } from '@spirula/engine-rpc/host';
import {
  createExtensionRuntime,
  createRestrictedRunner,
  discoverExtensions,
} from '@spirula/extension-host';
import type { ExtensionRuntime } from '@spirula/extension-host';
import { extensionRoots } from '../extension-roots.ts';

/** Сообщения main → хост расширений (`process.parentPort`). */
type ExtHostMessage =
  | {
      type: 'init';
      libraryRoot: string;
      restrictedEntry: string;
      bundledExtensionsDir?: string;
      userExtensionsDir?: string;
      devExtensionsDir?: string;
    }
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
    const { extensions } = await discoverExtensions({
      roots: extensionRoots(message),
      logger,
    });
    const library = createNodeFsCourseSource(message.libraryRoot);
    runtime = createExtensionRuntime({
      extensions,
      library,
      logger,
      // расширения не из поставки с `isolated` исполняются в ограниченном процессе
      runners: {
        create: (extension) =>
          createRestrictedRunner({
            extension,
            entryPath: message.restrictedEntry,
            library,
            logger,
          }),
      },
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
