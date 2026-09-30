import { createMemoryRepositoryStore } from '../../src/node/memory-repository-store.ts';
import { describeRepositoryStoreContract } from './repository-store.contract.ts';

describeRepositoryStoreContract('memory', async () =>
  createMemoryRepositoryStore(),
);
