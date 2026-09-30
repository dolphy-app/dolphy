import { vi } from 'vitest';

export const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export const nullLibrary = {
  readText: async (): Promise<string> => '',
  stat: async () => null,
};
