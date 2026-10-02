import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-sdk',
    include: ['test/**/*.test.ts'],
    environment: 'happy-dom',
    typecheck: {
      enabled: true,
      // the generated-ids types: the fixture declarations are part of this program only
      include: ['test/typed/**/*.test-d.ts'],
      tsconfig: './tsconfig.typed.json',
    },
  },
});
