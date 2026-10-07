import { describe, expectTypeOf, it } from 'vitest';
import type { Component } from 'vue';
import {
  defineClient,
  defineServer,
  type ClientContext,
  type InjectionRegistration,
  type ServerContext,
} from '@dolphy-app/extension-sdk';
import type { InjectionHandle, PanelHandle } from '@dolphy-app/extension-api';
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
        .toEqualTypeOf<Component>();
      expectTypeOf(client.addMarkdownRenderer)
        .parameter(1)
        .toEqualTypeOf<Component>();
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
});
