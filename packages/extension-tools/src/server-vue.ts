import path from 'node:path';
import type { Plugin } from 'vite';
import type { JobState } from './shim.ts';

const VUE_FILE = /\.vue(?:\?|$)/;
const STUB_PREFIX = '\0dolphy-ext:server-vue:';
const MARK = 'dolphy-ext:server-vue:';

/** The stub as it stays in the code of a chunk (a comment with the module id may precede it). */
const STUB_LITERAL = new RegExp(`"${MARK}(?:[^"\\\\]|\\\\.)*"`);

/**
 * Boundary of a Node bundle: a `.vue` file is a component of the client part.
 * The server file is built without the compiler of components, and
 * `src/index.ts` may import a component for `client`, so the file is replaced
 * by a stub that tree shaking drops with the rest of the client code. A stub
 * that is still in the output means the server code uses the component: that
 * is the error, with the file in the message.
 */
export const serverVuePlugin = (
  root: string,
  output: string,
  state: JobState,
): Plugin => ({
  name: 'dolphy-ext:server-vue',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!VUE_FILE.test(source)) return null;
    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    });
    if (resolved === null || resolved.external === true) return null;
    return { id: `${STUB_PREFIX}${resolved.id}`, moduleSideEffects: false };
  },
  load(id) {
    return id.startsWith(STUB_PREFIX)
      ? `export default ${JSON.stringify(`${MARK}${id.slice(STUB_PREFIX.length)}`)};\n`
      : null;
  },
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk') continue;
      const literal = STUB_LITERAL.exec(chunk.code)?.[0];
      if (literal === undefined) continue;
      const stub = JSON.parse(literal) as string;
      const file = stub.slice(MARK.length).split('?')[0] ?? '';
      const message = `${output} uses '${path.relative(root, file)}': a .vue component belongs to the client part, keep it out of the code of 'server'`;
      state.problem = message;
      this.error(message);
    }
  },
});
