import { describe, expect, it } from 'vitest';
import { createElement, useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { z } from 'zod';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import {
  defineRpc,
  type InjectionProps,
  type PanelHandle,
  type PanelProps,
} from '../src/index.ts';
import {
  reactComponent,
  useApp,
  useEngine,
  useInjection,
  useLocale,
  useMountContext,
  usePanel,
  useRpc,
  useTheme,
} from '../src/react.ts';
import { mountForTest } from '../src/testing.ts';

const panelProps = (props: PanelProps['props']): PanelProps => ({
  panelId: 'a.panel',
  props,
  context: { courseId: null },
});

const panelHandle = (props: PanelProps): PanelHandle => ({
  ...props,
  call: async (commandId) => commandId,
});

describe('reactComponent', () => {
  it('draws the component with the props of the context', async () => {
    const Panel = (props: PanelProps) =>
      createElement('p', null, `${props.panelId}:${String(props.props)}`);

    const mounted = await mountForTest(reactComponent(Panel), {
      props: panelProps(1),
    });

    expect(mounted.el.innerHTML).toBe('<p>a.panel:1</p>');
  });

  it('draws again on setProps, setTheme and setLocale', async () => {
    const Panel = (props: PanelProps) => {
      const theme = useTheme();
      const locale = useLocale();
      return createElement(
        'p',
        null,
        `${String(props.props)}:${theme.id}:${locale}`,
      );
    };
    const mounted = await mountForTest(reactComponent(Panel), {
      props: panelProps(1),
      theme: { id: 'light', dark: false },
    });

    mounted.setProps(panelProps(2));
    expect(mounted.el.textContent).toBe('2:light:en');
    mounted.setTheme({ id: 'night', dark: true });
    expect(mounted.el.textContent).toBe('2:night:en');
    mounted.setLocale('ru');
    expect(mounted.el.textContent).toBe('2:night:ru');
  });

  it('removes the tree and stops listening on unmount', async () => {
    const effects: string[] = [];
    const Panel = () => {
      useEffect(() => {
        effects.push('mounted');
        return () => void effects.push('cleaned');
      }, []);
      return createElement('p', null, 'x');
    };
    const mounted = await mountForTest(reactComponent(Panel), {
      props: panelProps(undefined),
    });
    expect(mounted.el.textContent).toBe('x');

    await mounted.unmount();
    mounted.setProps(panelProps(5));

    expect(mounted.el.textContent).toBe('');
    expect(effects).toEqual(['mounted', 'cleaned']);
  });

  it('reports a render error to ctx.reportError and draws nothing in its place', async () => {
    const failure = new Error('render failed');
    const Broken = (): never => {
      throw failure;
    };

    const mounted = await mountForTest(reactComponent(Broken), {
      props: panelProps(undefined),
    });

    expect(mounted.errors).toEqual([failure]);
    expect(mounted.el.textContent).toBe('');
  });

  it('reports an error of a later render and keeps no stale tree', async () => {
    const failure = new Error('bad props');
    const Panel = (props: PanelProps) => {
      if (props.props === 'bad') throw failure;
      return createElement('p', null, 'ok');
    };
    const mounted = await mountForTest(reactComponent(Panel), {
      props: panelProps('good'),
    });

    mounted.setProps(panelProps('bad'));

    expect(mounted.errors).toEqual([failure]);
    expect(mounted.el.textContent).toBe('');
  });

  it('the hooks read the context of the mount', async () => {
    const calls: string[] = [];
    const engine = {
      extensions: {
        invokeRpc: async () => 'pong',
      },
    } as unknown as ExtensionEngine;
    const ping = defineRpc({
      name: 'ping.ping',
      input: z.string(),
      output: z.string(),
    });
    const props = panelProps('p');
    const Panel = () => {
      const app = useApp();
      const appEngine = useEngine();
      const ctx = useMountContext<PanelProps, PanelHandle>();
      const handle = usePanel();
      const rpc = useRpc(ping);
      useEffect(() => {
        void rpc('ping').then((answer) => calls.push(answer));
      }, [rpc]);
      return createElement(
        'p',
        null,
        [
          app === ctx.app,
          appEngine === engine,
          handle === ctx.handle,
          handle.panelId,
        ].join(':'),
      );
    };

    const mounted = await mountForTest(
      reactComponent<PanelProps, PanelHandle>(Panel),
      {
        props,
        handle: panelHandle(props),
        engine,
        app: {
          notify: () => undefined,
        } as unknown as NonNullable<Parameters<typeof mountForTest>[1]['app']>,
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(mounted.el.textContent).toBe('true:true:true:a.panel');
    expect(calls).toEqual(['pong']);
  });

  it('useInjection gives the injection handle', async () => {
    const target = document.createElement('div');
    const props: InjectionProps = { target, position: 'after' };
    const Injected = () => {
      const handle = useInjection();
      return createElement('p', null, handle.position);
    };

    const mounted = await mountForTest(
      reactComponent<InjectionProps, InjectionProps>(Injected),
      { props, handle: props },
    );

    expect(mounted.el.textContent).toBe('after');
  });

  it('the hooks refuse to work outside an adapter or on the wrong surface', async () => {
    const Outside = () => {
      useApp();
      return null;
    };
    const WrongSurface = () => {
      usePanel();
      return null;
    };
    const mounted = await mountForTest(reactComponent(WrongSurface), {
      props: {},
    });

    expect(String(mounted.errors[0])).toContain(
      'usePanel() works inside a panel',
    );
    expect(() => renderToString(createElement(Outside))).toThrow(
      'useApp() works inside a component that reactComponent() draws',
    );
  });
});
