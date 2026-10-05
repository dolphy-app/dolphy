import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'keybindings',
    include: ['test/**/*.test.ts'],
  },
});
