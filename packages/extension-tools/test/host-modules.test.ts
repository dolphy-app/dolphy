import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  HOST_GLOBAL,
  hostModulesPlugin,
  rewriteHostImports,
} from '../src/host-modules.ts';
import { makeTemp } from './helpers.ts';

const countLines = (text: string): number => text.split('\n').length;

describe('rewriteHostImports', () => {
  it('turns named, aliased, namespace and default imports of host modules into reads from the host loader', () => {
    const code = [
      'import { ref, h as hyper } from "vue";',
      'import * as vuetify from "vuetify";',
      'import vuetifyDefault from "vuetify/components";',
      'export const a = ref(hyper("div"), vuetify, vuetifyDefault);',
    ].join('\n');
    const out = rewriteHostImports(code);
    expect(out).not.toMatch(/^import /m);
    expect(out).toContain(
      `const ${HOST_GLOBAL}_0 = await globalThis.${HOST_GLOBAL}.require("vue");`,
    );
    expect(out).toContain('const { ref, h: hyper } = __dolphy_0;');
    expect(out).toContain('const vuetify = __dolphy_1;');
    expect(out).toContain('const vuetifyDefault = __dolphy_2.default;');
  });

  it('leaves other imports alone and drops the style sheet imports of the host', () => {
    const code = [
      'import "vuetify/styles";',
      'import { x } from "./local.js";',
      'import fs from "node:fs";',
      'export { x, fs };',
    ].join('\n');
    const out = rewriteHostImports(code);
    expect(out).not.toContain('vuetify/styles');
    expect(out).toContain('import { x } from "./local.js";');
    expect(out).toContain('import fs from "node:fs";');
  });

  it('keeps the number of lines, so source maps stay valid', () => {
    const code = [
      'import {',
      '  ref,',
      '  computed,',
      '} from "vue";',
      'export const a = ref(computed);',
    ].join('\n');
    expect(countLines(rewriteHostImports(code))).toBe(countLines(code));
  });
});

describe('hostModulesPlugin', () => {
  it('builds a module that imports Vue and Vuetify without them in the bundle', async () => {
    const root = await makeTemp();
    const entry = path.join(root, 'widget.ts');
    await writeFile(
      entry,
      [
        "import { defineComponent, h } from 'vue';",
        "import { VAlert } from 'vuetify/components';",
        "import 'vuetify/styles';",
        'export default defineComponent({ render: () => h(VAlert) });',
      ].join('\n'),
    );
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [hostModulesPlugin()],
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['es'], fileName: () => 'out.mjs' },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (output === undefined || !('output' in output)) {
      throw new Error('unexpected build result');
    }
    const chunk = output.output[0];
    if (chunk === undefined || chunk.type !== 'chunk') {
      throw new Error('the build produced no chunk');
    }
    const code = chunk.code;
    expect(code).not.toMatch(/from ["']vue["']/);
    expect(code).not.toMatch(/from ["']vuetify/);
    expect(code).not.toContain('vuetify/styles');
    expect(code).toContain(`globalThis.${HOST_GLOBAL}.require("vue")`);
    expect(code).toContain(
      `globalThis.${HOST_GLOBAL}.require("vuetify/components")`,
    );
    expect(code.length).toBeLessThan(2_000);
  });

  it('rejects a subpath of a window module with a hint to import from vuetify/components', async () => {
    const root = await makeTemp();
    const entry = path.join(root, 'widget.ts');
    await writeFile(
      entry,
      [
        "import { VBtn } from 'vuetify/components/VBtn';",
        'export default VBtn;',
      ].join('\n'),
    );
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [hostModulesPlugin()],
        build: {
          write: false,
          lib: { entry, formats: ['es'], fileName: () => 'out.mjs' },
        },
      }),
    ).rejects.toThrow(/import the components from 'vuetify\/components'/);
  });
});
