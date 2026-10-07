import { describe, expectTypeOf, it } from 'vitest';
import type { Component } from 'vue';
import {
  defineClient,
  defineMountable,
  defineServer,
  type ClientContext,
  type InjectionRegistration,
  type Mountable,
  type MountContext,
  type ServerContext,
} from '@dolphy-app/extension-sdk';
import type {
  AnswerViewProps,
  InjectionHandle,
  InjectionProps,
  MarkdownBlockProps,
  PanelHandle,
  PanelProps,
} from '@dolphy-app/extension-api';
import { useInjection, usePanel } from '@dolphy-app/extension-sdk/client';

describe('entry types', () => {
  it('a client entry gets Vue components, a server entry the server context', () => {
    defineClient((client) => {
      expectTypeOf(client).toEqualTypeOf<ClientContext>();
      expectTypeOf(client.addInjection)
        .parameter(0)
        .toEqualTypeOf<InjectionRegistration>();
      expectTypeOf(client.addAnswerView)
        .parameter(1)
        .toEqualTypeOf<Component | Mountable<AnswerViewProps>>();
      expectTypeOf(client.addMarkdownRenderer)
        .parameter(1)
        .toEqualTypeOf<Component | Mountable<MarkdownBlockProps>>();
      // @ts-expect-error a component is not a string
      client.addInjection({ id: 'a.x', target: 'body', component: 'x' });
    });
    defineServer((server) => {
      expectTypeOf(server).toEqualTypeOf<ServerContext>();
    });
  });

  it('usePanel narrows the command ids, useInjection gives the injection handle', () => {
    expectTypeOf(usePanel<'a.go'>()).toEqualTypeOf<PanelHandle<'a.go'>>();
    expectTypeOf(useInjection()).toEqualTypeOf<InjectionHandle>();
    expectTypeOf(usePanel().call).parameter(0).toEqualTypeOf<string>();
  });

  it('a Mountable is accepted by every surface with its own props and handle', () => {
    defineClient((client) => {
      const panel = defineMountable<PanelProps, PanelHandle>((_el, ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<
          MountContext<PanelProps, PanelHandle>
        >();
        expectTypeOf(ctx.props.panelId).toEqualTypeOf<string>();
        expectTypeOf(ctx.handle.call).parameter(0).toEqualTypeOf<string>();
        return () => undefined;
      });
      const injection = defineMountable<InjectionProps, InjectionHandle>(
        () => async () => undefined,
      );
      const answer = defineMountable<AnswerViewProps>((_el, ctx) => {
        expectTypeOf(ctx.handle).toEqualTypeOf<undefined>();
        ctx.emit('change', { value: 1, complete: true });
        return () => undefined;
      });
      const markdown = defineMountable<MarkdownBlockProps>((el, ctx) => {
        el.textContent = ctx.props.source;
        return () => undefined;
      });
      client.addPanel({ id: 'a.p', title: 'P', component: panel });
      client.addInjection({ id: 'a.i', target: 'body', component: injection });
      client.addAnswerView('a.type', answer);
      client.addMarkdownRenderer('chart', markdown);
    });
  });

  it('mount must return a cleanup', () => {
    // @ts-expect-error the cleanup is required
    defineMountable<PanelProps>(() => undefined);
  });
});
