// Дочерний процесс extension host: runtime поверх IPC (`process.send`).
import { fileURLToPath } from 'node:url';
import { discoverExtensions } from '../../src/discover.ts';
import { createExtensionRuntime } from '../../src/runtime.ts';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const root = fileURLToPath(new URL('./extensions', import.meta.url));
const { extensions } = await discoverExtensions({
  roots: [{ dir: root, origin: 'bundled' }],
  logger: silent,
});
const runtime = createExtensionRuntime({
  extensions,
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
