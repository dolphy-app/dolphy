import { describe, expect, it, vi } from 'vitest';
import type {
  ContributionsDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  createContributionsStore,
  NO_CONTRIBUTIONS,
} from '@/shared/api/engine/contributions.ts';
import { createEventBus } from './support/extensions-fakes.ts';

const dto = (
  generation: number,
  policyIds: string[] = [],
): ContributionsDto => ({
  ...NO_CONTRIBUTIONS,
  generation,
  gradePolicies: policyIds.map((id) => ({
    id,
    extensionId: id,
    label: id,
  })),
});

interface Call {
  resolve(value: ContributionsDto): void;
  reject(error: Error): void;
}

/** Каждый `contributions()` ждёт, пока тест не разрешит его вручную. */
const setup = async (first: ContributionsDto) => {
  const bus = createEventBus();
  const calls: Call[] = [];
  let initial = true;
  const engine = {
    subscribe: bus.subscribe,
    extensions: {
      contributions: () => {
        if (initial) {
          initial = false;
          return Promise.resolve(first);
        }
        return new Promise<ContributionsDto>((resolve, reject) => {
          calls.push({ resolve, reject });
        });
      },
    },
  } as unknown as LearningEngine;
  const store = await createContributionsStore(engine);
  return { store, bus, calls };
};

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const ids = (store: { contributions: { value: ContributionsDto } }) =>
  store.contributions.value.gradePolicies.map(({ id }) => id);

describe('createContributionsStore', () => {
  it('reads contributions once at creation and publishes them reactively', async () => {
    const { store } = await setup(dto(0, ['a.one']));
    expect(ids(store)).toEqual(['a.one']);
  });

  it('re-reads after contributions-changed', async () => {
    const { store, bus, calls } = await setup(dto(0));
    bus.emit({ type: 'contributions-changed', generation: 1 });
    await flush();
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(dto(1, ['a.two']));
    await flush();
    expect(ids(store)).toEqual(['a.two']);
    expect(store.contributions.value.generation).toBe(1);
  });

  it('drops a stale answer that arrives after a newer one', async () => {
    const { store, bus, calls } = await setup(dto(0));
    bus.emit({ type: 'contributions-changed', generation: 1 });
    bus.emit({ type: 'contributions-changed', generation: 2 });
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]?.resolve(dto(2, ['newer']));
    await flush();
    calls[0]?.resolve(dto(1, ['older']));
    await flush();
    expect(ids(store)).toEqual(['newer']);
    expect(store.contributions.value.generation).toBe(2);
  });

  it('drops an answer older than the generation already announced by an event', async () => {
    const { store, bus, calls } = await setup(dto(0));
    bus.emit({ type: 'contributions-changed', generation: 1 });
    await flush();
    bus.emit({ type: 'contributions-changed', generation: 2 });
    await flush();
    calls[0]?.resolve(dto(1, ['older']));
    await flush();
    expect(ids(store)).toEqual([]);
    calls[1]?.resolve(dto(2, ['newer']));
    await flush();
    expect(ids(store)).toEqual(['newer']);
  });

  it('keeps the previous contributions when a re-read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, bus, calls } = await setup(dto(0, ['kept']));
    bus.emit({ type: 'contributions-changed', generation: 1 });
    await flush();
    calls[0]?.reject(new Error('engine busy'));
    await flush();
    expect(ids(store)).toEqual(['kept']);
    error.mockRestore();
  });

  it('after a reconnect the generation restarts: the lower number is accepted', async () => {
    const { store, bus, calls } = await setup(dto(0));
    bus.emit({ type: 'contributions-changed', generation: 7 });
    await flush();
    calls[0]?.resolve(dto(7, ['before']));
    await flush();
    expect(store.contributions.value.generation).toBe(7);

    const reconnected = store.reconnected();
    calls[1]?.resolve(dto(0, ['after']));
    await reconnected;
    expect(store.contributions.value.generation).toBe(0);
    expect(ids(store)).toEqual(['after']);
  });

  it('ignores an answer from the previous engine that lands after the reconnect', async () => {
    const { store, bus, calls } = await setup(dto(0));
    bus.emit({ type: 'contributions-changed', generation: 5 });
    await flush();
    const reconnected = store.reconnected();
    calls[1]?.resolve(dto(0, ['fresh']));
    await reconnected;
    calls[0]?.resolve(dto(5, ['ghost']));
    await flush();
    expect(ids(store)).toEqual(['fresh']);
  });

  it('stops listening after dispose', async () => {
    const { store, bus, calls } = await setup(dto(0));
    store.dispose();
    bus.emit({ type: 'contributions-changed', generation: 1 });
    await flush();
    expect(calls).toHaveLength(0);
    expect(bus.count()).toBe(0);
  });
});

describe('createContributionsStore: команды и клиентские части', () => {
  const command = (id: string, extensionId = 'acme.cmd') => ({
    id,
    extensionId,
    title: id,
    description: null,
    category: null,
    keybindings: [],
    when: null,
    palette: true,
    icon: 'puzzle',
  });
  const client = (revision: string) => ({
    extensionId: 'acme.cmd',
    url: 'dolphy-ext://acme.cmd/client.mjs',
    origin: 'user' as const,
    revision,
  });

  it('before the first answer both lists are empty and typed', async () => {
    const { store } = await setup(dto(0));
    expect(store.contributions.value.commands).toEqual([]);
    expect(store.contributions.value.clients).toEqual([]);
  });

  it('replaces commands and clients wholesale with each generation: removal and a new revision are visible', async () => {
    const first = {
      ...dto(0),
      commands: [command('acme.cmd.one'), command('acme.cmd.two')],
      clients: [client('r1')],
    };
    const { store, bus, calls } = await setup(first);
    expect(store.contributions.value.commands).toHaveLength(2);

    bus.emit({ type: 'contributions-changed', generation: 1 });
    await flush();
    calls[0]?.resolve({
      ...dto(1),
      commands: [command('acme.cmd.two')],
      clients: [client('r2')],
    });
    await flush();
    expect(store.contributions.value.commands.map(({ id }) => id)).toEqual([
      'acme.cmd.two',
    ]);
    expect(store.contributions.value.clients[0]?.revision).toBe('r2');

    bus.emit({ type: 'contributions-changed', generation: 2 });
    await flush();
    calls[1]?.resolve(dto(2));
    await flush();
    expect(store.contributions.value.commands).toEqual([]);
    expect(store.contributions.value.clients).toEqual([]);
  });
});
