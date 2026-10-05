import { useQueryCache } from '@pinia/colada';
import { createApp } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  EngineEvent,
  LearningEngine,
  RepositoryPreviewDto,
} from '@dolphy-app/engine-contract';
import { createDolphyQuery } from '@/app/providers/query.ts';
import { loadRepositoryPreview } from '@/entities/repository';

const listing: RepositoryPreviewDto = {
  url: 'https://x.test/acme',
  ref: null,
  commit: 'a'.repeat(40),
  courses: [],
};

const setup = () => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const preview = vi.fn(() => Promise.resolve(listing));
  const engine = {
    subscribe: (listener: (event: EngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    repositories: { preview },
  } as unknown as LearningEngine;
  const query = createDolphyQuery(engine);
  const app = createApp({}).use(query);
  const cache = app.runWithContext(() => useQueryCache());
  const load = () => loadRepositoryPreview(cache, engine, { url: listing.url });
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { query, preview, load, emit };
};

describe('createDolphyQuery', () => {
  it('library-reloaded из движка сбрасывает кэш предпросмотров приложения', async () => {
    const { preview, load, emit } = setup();
    await load();
    await load();
    expect(preview).toHaveBeenCalledTimes(1);
    emit({ type: 'library-reloaded', revision: 'r', errors: 0, warnings: 0 });
    await load();
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('переподключение к движку сбрасывает кэш: события за обрыв могли потеряться', async () => {
    const { query, preview, load } = setup();
    await load();
    query.reconnected();
    await load();
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('прочие события кэш не трогают', async () => {
    const { preview, load, emit } = setup();
    await load();
    emit({ type: 'progress', unitIds: [], at: 0 });
    await load();
    expect(preview).toHaveBeenCalledTimes(1);
  });
});
