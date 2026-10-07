import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import {
  defineClient,
  defineMountable,
  defineRpc,
  type AnswerViewProps,
  type PanelProps,
} from '../src/index.ts';
import { createTestClient, mountForTest } from '../src/testing.ts';

const panelProps: PanelProps = {
  panelId: 'a.panel',
  props: undefined,
  context: { courseId: null },
};

describe('createTestClient with a Mountable', () => {
  it('records the Mountable as registered, on every surface', async () => {
    const mountable = defineMountable(() => () => undefined);
    const client = await createTestClient(
      defineClient((c) => {
        c.addPanel({ id: 'a.panel', title: 'Panel', component: mountable });
        c.addInjection({ id: 'a.i', target: 'body', component: mountable });
        c.addAnswerView('a.type', mountable);
        c.addMarkdownRenderer('chart', mountable);
      }),
    );

    expect(client.panels[0]?.component).toBe(mountable);
    expect(client.injections[0]?.component).toBe(mountable);
    expect(client.answerViews.get('a.type')).toBe(mountable);
    expect(client.markdownRenderers.get('chart')).toBe(mountable);
  });
});

describe('mountForTest', () => {
  it('mounts into a new element and gives the context the options', async () => {
    const mountable = defineMountable<PanelProps>((el, ctx) => {
      el.textContent = `${ctx.extensionId}:${ctx.props.panelId}:${ctx.theme.id}:${ctx.locale}`;
      return () => {
        el.textContent = '';
      };
    });

    const mounted = await mountForTest(mountable, {
      props: panelProps,
      extensionId: 'acme.x',
      theme: { id: 'night', dark: true },
      locale: 'ru',
    });

    expect(mounted.el.textContent).toBe('acme.x:a.panel:night:ru');
    await mounted.unmount();
    expect(mounted.el.textContent).toBe('');
  });

  it('draws into the element the test passes', async () => {
    const el = document.createElement('section');
    const mounted = await mountForTest(
      defineMountable((target) => {
        target.append('hi');
        return () => undefined;
      }),
      { props: undefined, el },
    );

    expect(mounted.el).toBe(el);
    expect(el.textContent).toBe('hi');
  });

  it('delivers setProps, setTheme and setLocale to the listeners and updates the snapshots', async () => {
    const seen: string[] = [];
    const mounted = await mountForTest(
      defineMountable<{ n: number }>((_el, ctx) => {
        const stops = [
          ctx.onProps((props) => seen.push(`props:${props.n}`)),
          ctx.onTheme((theme) => seen.push(`theme:${theme.id}`)),
          ctx.onLocale((locale) => seen.push(`locale:${locale}`)),
        ];
        return () => {
          for (const stop of stops) stop();
        };
      }),
      { props: { n: 1 } },
    );

    mounted.setProps({ n: 2 });
    mounted.setTheme({ id: 'dark', dark: true });
    mounted.setLocale('ru');

    expect(seen).toEqual(['props:2', 'theme:dark', 'locale:ru']);
    expect(mounted.ctx.props).toEqual({ n: 2 });
    expect(mounted.ctx.theme).toEqual({ id: 'dark', dark: true });
    expect(mounted.ctx.locale).toBe('ru');
    await mounted.unmount();
    mounted.setProps({ n: 3 });
    expect(seen).toHaveLength(3);
  });

  it('records emitted events and reported errors in order', async () => {
    const failure = new Error('boom');
    const mounted = await mountForTest(
      defineMountable<AnswerViewProps>((_el, ctx) => {
        ctx.emit('change', { value: 'a', complete: true });
        ctx.emit('submit');
        ctx.reportError(failure);
        return () => undefined;
      }),
      {
        props: {
          view: null,
          value: undefined,
          disabled: false,
          verdict: null,
          label: null,
        },
      },
    );

    expect(mounted.emitted).toEqual([
      ['change', { value: 'a', complete: true }],
      ['submit', undefined],
    ]);
    expect(mounted.errors).toEqual([failure]);
  });

  it('aborts the signal and runs the cleanup once on unmount', async () => {
    let cleanups = 0;
    let aborted = false;
    const mounted = await mountForTest(
      defineMountable((_el, ctx) => {
        ctx.signal.addEventListener('abort', () => {
          aborted = true;
        });
        return async () => {
          cleanups += 1;
        };
      }),
      { props: undefined },
    );

    expect(mounted.ctx.signal.aborted).toBe(false);
    await mounted.unmount();
    await mounted.unmount();

    expect(aborted).toBe(true);
    expect(cleanups).toBe(1);
  });

  it('ctx.callRpc goes through the engine of the test with the extension id', async () => {
    const hello = defineRpc({
      name: 'greeting.say-hello',
      input: z.string(),
      output: z.string(),
    });
    const requests: unknown[] = [];
    const engine = {
      extensions: {
        invokeRpc: async (request: unknown) => {
          requests.push(request);
          return 'hi';
        },
      },
    } as unknown as ExtensionEngine;
    const mounted = await mountForTest(
      defineMountable(() => () => undefined),
      {
        props: undefined,
        engine,
        extensionId: 'acme.hello',
      },
    );

    await expect(mounted.ctx.callRpc(hello, 'Ada')).resolves.toBe('hi');
    expect(requests).toEqual([
      { extensionId: 'acme.hello', name: 'greeting.say-hello', input: 'Ada' },
    ]);
  });

  it('names the option when the component uses the app or the engine the test did not pass', async () => {
    const mounted = await mountForTest(
      defineMountable(() => () => undefined),
      {
        props: undefined,
      },
    );

    expect(() => mounted.ctx.app.notify('x')).toThrow('options.app');
    expect(() => mounted.ctx.engine.extensions).toThrow('options.engine');
  });

  it('rejects with what mount throws', async () => {
    await expect(
      mountForTest(
        defineMountable(() => {
          throw new Error('mount failed');
        }),
        { props: undefined },
      ),
    ).rejects.toThrow('mount failed');
  });
});
