// Дочерний процесс extension host: runtime поверх IPC (`process.send`); набор расширений приходит сообщением `replaceExtensions`.
import { createExtensionRuntime } from '../../src/runtime.ts';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const runtime = createExtensionRuntime({
  logger: silent,
  library: {
    readText: async () => '',
    stat: async () => null,
  },
});
const listeners = [];
runtime.attach({
  post: (message) => process.send(message),
  onMessage: (listener) => listeners.push(listener),
  onClose: () => {},
  close: () => {},
});
process.on('message', (message) => {
  for (const listener of listeners) listener(message);
});
process.send({ ready: true });
