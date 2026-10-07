// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';
import type { App } from 'vue';
import { z } from 'zod';
import { ENGINE_KEY } from '@dolphy-app/extension-api';
import type { AppLocale, AppTheme } from '@dolphy-app/extension-api';
import { defineRpc } from '@dolphy-app/extension-sdk/rpc';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import MountableHost from '@/shared/ui/MountableHost.vue';
import { fakeAppApi, fakeApps } from './support/app-fakes.ts';
import { fakeMountable } from './support/mountable-fakes.ts';
import type { AnyContext } from './support/mountable-fakes.ts';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await nextTick();
};

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const setup = async (mountable: ReturnType<typeof fakeMountable>) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const props = shallowRef<Record<string, unknown>>({ n: 1 });
  const theme = shallowRef<AppTheme>({ id: 'light', dark: false });
  const locale = shallowRef<AppLocale>('en');
  const events: unknown[] = [];
  const invokeRpc = vi.fn(async (): Promise<unknown> => ({ ok: true }));
  const engine = { extensions: { invokeRpc } };
  const api = fakeAppApi();
  Object.defineProperties(api, {
    theme: { get: () => theme.value },
    locale: { get: () => locale.value },
  });
  const show = shallowRef(true);
  const app = createApp({
    render: () =>
      show.value
        ? h(MountableHost, {
            extensionId: 'acme.cards',
            mountable: mountable.mountable,
            props: props.value,
            onChange: (detail: unknown) => events.push(['change', detail]),
            onSubmit: () => events.push(['submit']),
            onError: (error: unknown) => events.push(['error', error]),
          })
        : h('i'),
  });
  app.provide(EXTENSION_APPS_KEY, fakeApps(api).apps);
  app.provide(ENGINE_KEY, engine);
  apps.push(app);
  const root = document.createElement('div');
  document.body.append(root);
  app.mount(root);
  await flush();
  return { root, props, theme, locale, events, show, invokeRpc, app };
};

const ctxOf = (mountable: ReturnType<typeof fakeMountable>): AnyContext => {
  const call = mountable.calls[0];
  if (call === undefined) throw new Error('mount was not called');
  return call.ctx;
};

describe('MountableHost', () => {
  it('вызывает mount один раз на выданном div с текущими props', async () => {
    const mountable = fakeMountable();
    const { root } = await setup(mountable);
    expect(mountable.calls).toHaveLength(1);
    expect(mountable.calls[0]?.el).toBe(root.querySelector('div'));
    expect(root.textContent).toBe('{"n":1}');
    const ctx = ctxOf(mountable);
    expect(ctx.extensionId).toBe('acme.cards');
    expect(ctx.signal.aborted).toBe(false);
  });

  it('onProps доставляет новый снимок; старый не меняется', async () => {
    const mountable = fakeMountable();
    const { props } = await setup(mountable);
    const ctx = ctxOf(mountable);
    const first = ctx.props;
    const listener = vi.fn();
    ctx.onProps(listener);
    props.value = { n: 2 };
    await flush();
    expect(listener).toHaveBeenCalledExactlyOnceWith({ n: 2 });
    expect(ctx.props).toEqual({ n: 2 });
    expect(first).toEqual({ n: 1 });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('отписка и размонтирование прекращают доставку', async () => {
    const mountable = fakeMountable();
    const { props, show } = await setup(mountable);
    const ctx = ctxOf(mountable);
    const stopped = vi.fn();
    const live = vi.fn();
    ctx.onProps(live);
    ctx.onProps(stopped)();
    props.value = { n: 2 };
    await flush();
    expect(stopped).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledOnce();
    show.value = false;
    await flush();
    props.value = { n: 3 };
    await flush();
    expect(live).toHaveBeenCalledOnce();
  });

  it('emit: change и submit доходят до хоста, прочие события игнорируются', async () => {
    const mountable = fakeMountable();
    const { events } = await setup(mountable);
    const ctx = ctxOf(mountable);
    ctx.emit('change', { value: 'b', complete: true });
    ctx.emit('submit');
    ctx.emit('other', 1);
    expect(events).toEqual([
      ['change', { value: 'b', complete: true }],
      ['submit'],
    ]);
  });

  it('тема и язык: текущие значения и подписки', async () => {
    const mountable = fakeMountable();
    const { theme, locale } = await setup(mountable);
    const ctx = ctxOf(mountable);
    expect(ctx.theme).toEqual({ id: 'light', dark: false });
    expect(ctx.locale).toBe('en');
    const onTheme = vi.fn();
    const onLocale = vi.fn();
    ctx.onTheme(onTheme);
    ctx.onLocale(onLocale);
    theme.value = { id: 'night', dark: true };
    locale.value = 'ru';
    await flush();
    expect(onTheme).toHaveBeenCalledExactlyOnceWith({
      id: 'night',
      dark: true,
    });
    expect(onLocale).toHaveBeenCalledExactlyOnceWith('ru');
    expect(ctx.theme).toEqual({ id: 'night', dark: true });
    expect(ctx.locale).toBe('ru');
  });

  it('размонтирование отменяет signal и вызывает очистку', async () => {
    const mountable = fakeMountable();
    const { show } = await setup(mountable);
    const { signal } = ctxOf(mountable);
    show.value = false;
    await flush();
    expect(signal.aborted).toBe(true);
    expect(mountable.cleanup).toHaveBeenCalledOnce();
  });

  it('сбой синхронного mount уходит в error и журнал', async () => {
    const boom = new Error('boom');
    const mountable = fakeMountable(() => {
      throw boom;
    });
    const { events } = await setup(mountable);
    expect(events).toEqual([['error', boom]]);
    expect(console.error).toHaveBeenCalled();
  });

  it('сбой асинхронного mount и reportError уходят в error', async () => {
    const boom = new Error('late');
    const mountable = fakeMountable(async () => {
      throw boom;
    });
    const { events } = await setup(mountable);
    expect(events).toEqual([['error', boom]]);
    const other = fakeMountable();
    const second = await setup(other);
    const failure = new Error('reported');
    ctxOf(other).reportError(failure);
    expect(second.events).toEqual([['error', failure]]);
  });

  it('сбой очистки пишется в журнал', async () => {
    const mountable = fakeMountable(() => () => {
      throw new Error('cleanup');
    });
    const { show } = await setup(mountable);
    show.value = false;
    await flush();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: new Error('cleanup') }),
      'mountable component failed',
    );
  });

  it('размонтирование во время async mount вызывает очистку, как только она возвращена', async () => {
    let resolve: (value: () => void) => void = () => undefined;
    const cleanup = vi.fn();
    const mountable = fakeMountable(
      () =>
        new Promise<() => void>((done) => {
          resolve = done;
        }),
    );
    const { show } = await setup(mountable);
    show.value = false;
    await flush();
    expect(cleanup).not.toHaveBeenCalled();
    resolve(cleanup);
    await flush();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(ctxOf(mountable).signal.aborted).toBe(true);
  });

  it('callRpc идёт через движок расширения', async () => {
    const mountable = fakeMountable();
    const { invokeRpc } = await setup(mountable);
    const ping = defineRpc({
      name: 'acme.cards.ping',
      input: z.object({ n: z.number() }),
      output: z.object({ ok: z.boolean() }),
    });
    await expect(ctxOf(mountable).callRpc(ping, { n: 1 })).resolves.toEqual({
      ok: true,
    });
    expect(invokeRpc).toHaveBeenCalledExactlyOnceWith({
      extensionId: 'acme.cards',
      name: 'acme.cards.ping',
      input: { n: 1 },
    });
  });
});
