import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
  defineExtensionPanel,
  defineMarkdownRenderer,
  openPanel,
  type AnswerView,
  type ExtensionContext,
  type ExtensionMarkdown,
  type ExtensionPanels,
  type ExtensionViews,
  type SettingChange,
  type SettingValue,
} from '../src/index.ts';
import { loadCommands, loadEvents } from '../src/testing.ts';

// No generated declarations are part of this program: every id is a string.
describe('without generated ids', () => {
  it('ids are plain strings and every record is optional and open', async () => {
    const seen: unknown[] = [];
    const module = defineExtension({
      exerciseTypes: {
        'any.type': defineExerciseType({
          project: () => ({}),
          grade: () => ({ outcome: 'passed' }),
        }),
      },
      events: { 'session.finished': () => undefined },
      commands: { 'any.command': () => 'ran' },
      activate(ctx) {
        expectTypeOf(ctx).toEqualTypeOf<ExtensionContext>();
        seen.push(ctx.settings.get('any.setting'));
        ctx.settings.onDidChange((change) => {
          expectTypeOf(change).toEqualTypeOf<SettingChange>();
          expectTypeOf(change).toEqualTypeOf<{
            id: string;
            value: SettingValue;
          }>();
        });
        ctx.commands.register('another.command', () => undefined);
        ctx.events.on('attempt.closed', () => undefined);
      },
    });
    expect(defineExtension({})).toEqual({
      activate: expect.any(Function),
      deactivate: expect.any(Function),
    });

    const commands = await loadCommands(module, {
      settings: {
        get: () => 7,
        onDidChange: () => ({ dispose: () => undefined }),
      },
    });
    expect(commands.ids()).toEqual(['any.command', 'another.command']);
    expect(seen).toEqual([7]);
    await commands.dispose();
    await (await loadEvents(defineExtension({}))).dispose();
  });

  it('views, panels and markdown take any keys', () => {
    const views = {
      'any.view': defineAnswerView(() => ({ update: () => undefined })),
    } satisfies ExtensionViews;
    const panels = {
      'any.panel': defineExtensionPanel({ mount: () => undefined }),
    } satisfies ExtensionPanels;
    const markdown = {
      any: defineMarkdownRenderer(() => undefined),
    } satisfies ExtensionMarkdown;
    expectTypeOf<ExtensionViews>().toEqualTypeOf<
      Readonly<Record<string, AnswerView>>
    >();
    expect(Object.keys({ ...views, ...panels, ...markdown })).toEqual([
      'any.view',
      'any.panel',
      'any',
    ]);
    expect(openPanel('any.panel')).toEqual({ openPanel: 'any.panel' });
  });
});
