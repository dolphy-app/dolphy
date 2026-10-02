import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExtension } from '../src/index.ts';
import { copyProject, runTsc as tsc } from './helpers.ts';

/** `<line> <TS code> <message>` of the diagnostics reported for `file`. */
const diagnosticsOf = (output: string, file: string): string[] =>
  output
    .split('\n')
    .map((line) =>
      new RegExp(`^${file}\\((\\d+),\\d+\\): error (TS\\d+): (.*)$`).exec(line),
    )
    .filter((match) => match !== null)
    .map(([, line, code, text]) => `${line} ${code} ${text}`);

describe('ids generated from extension.json, compiled by tsc', () => {
  it('a project that uses every declared id correctly compiles', async () => {
    const root = await copyProject('typed-ids');
    await buildExtension({ root });
    const { code, output } = await tsc(root);
    expect(code, output).toBe(0);
  });

  it('a wrong id, a wrong setting type and records off the manifest are errors', async () => {
    const root = await copyProject('typed-ids');
    await buildExtension({ root });
    const lines = [
      "import { defineExtension, inActivate } from '@dolphy-app/extension-sdk';",
      "import type { ExtensionViews } from '@dolphy-app/extension-sdk';",
      '',
      'export const wrongUse = defineExtension({',
      "  exerciseTypes: { 'acme.typed.echo': inActivate },",
      "  gradePolicies: { 'acme.typed.strict': inActivate },",
      "  events: { 'attempt.closed': inActivate },",
      "  commands: { 'acme.typed.open': inActivate, 'acme.typed.ping': inActivate },",
      '  activate(ctx) {',
      "    const goal: string = ctx.settings.get('acme.typed.goal');",
      "    const mode: 'fast' = ctx.settings.get('acme.typed.mode');",
      "    ctx.settings.get('acme.typed.missing');",
      "    ctx.commands.register('acme.typed.close', () => undefined);",
      "    ctx.events.on('session.started', () => undefined);",
      "    ctx.events.on('attempt.closed', ({ nope }) => void nope);",
      '    ctx.settings.onDidChange((change) => {',
      "      if (change.id === 'acme.typed.goal') {",
      '        const text: string = change.value;',
      '        void text;',
      '      }',
      '    });',
      '    void [goal, mode];',
      '  },',
      '});',
      '',
      'export const noGradePolicies = defineExtension({',
      "  exerciseTypes: { 'acme.typed.echo': inActivate },",
      "  events: { 'attempt.closed': inActivate },",
      "  commands: { 'acme.typed.open': inActivate, 'acme.typed.ping': inActivate },",
      '});',
      '',
      'export const noPingCommand = defineExtension({',
      "  exerciseTypes: { 'acme.typed.echo': inActivate },",
      "  gradePolicies: { 'acme.typed.strict': inActivate },",
      "  events: { 'attempt.closed': inActivate },",
      "  commands: { 'acme.typed.open': inActivate },",
      '});',
      '',
      'export const wrongViews = {',
      "  'acme.typed.other': 1 as never,",
      '} satisfies ExtensionViews;',
      '',
    ];
    await writeFile(path.join(root, 'src/wrong.ts'), lines.join('\n'));
    const at = (fragment: string): number =>
      lines.findIndex((line) => line.includes(fragment)) + 1;

    const { code, output } = await tsc(root);
    expect(code).toBe(1);
    const setting = /"acme\.typed\.(on|name|goal|mode)"/g;
    expect(diagnosticsOf(output, 'src/wrong\\.ts'), output).toEqual([
      `${at('const goal: string')} TS2322 Type 'number' is not assignable to type 'string'.`,
      `${at("const mode: 'fast'")} TS2322 Type '"fast" | "slow"' is not assignable to type '"fast"'.`,
      expect.stringMatching(
        new RegExp(
          `^${at("get('acme.typed.missing')")} TS2345 Argument of type '"acme\\.typed\\.missing"' is not assignable to parameter of type '(${setting.source}( \\| )?){4}'\\.$`,
        ),
      ),
      `${at("register('acme.typed.close'")} TS2345 Argument of type '"acme.typed.close"' is not assignable to parameter of type '"acme.typed.open" | "acme.typed.ping"'.`,
      `${at("on('session.started'")} TS2345 Argument of type '"session.started"' is not assignable to parameter of type '"attempt.closed"'.`,
      expect.stringMatching(
        new RegExp(
          `^${at('({ nope })')} TS2339 Property 'nope' does not exist`,
        ),
      ),
      `${at('const text: string')} TS2322 Type 'number' is not assignable to type 'string'.`,
      expect.stringMatching(
        new RegExp(`^${at('noGradePolicies')} TS2345 .*'ExtensionDefinition'`),
      ),
      expect.stringMatching(
        new RegExp(
          `^${at("commands: { 'acme.typed.open': inActivate },")} TS2741 Property '"acme\\.typed\\.ping"' is missing`,
        ),
      ),
      expect.stringMatching(
        new RegExp(
          `^${at("'acme.typed.other': 1")} TS2353 .*'acme\\.typed\\.other'`,
        ),
      ),
    ]);
  });
});
