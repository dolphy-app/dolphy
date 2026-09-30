import { defineConfig } from 'vite';

// `main` — код расширения под Node (самодостаточный ES-бандл);
// `view` — элемент ответа под браузер. Оба пишут в dist-ext/ без очистки.
export default defineConfig(({ mode }) => {
  const isMain = mode === 'main';
  return {
    publicDir: false,
    build: {
      target: isMain ? 'node22' : 'es2022',
      outDir: 'dist-ext',
      emptyOutDir: mode === 'main',
      minify: false,
      copyPublicDir: false,
      lib: {
        entry: isMain ? 'src/main.ts' : 'src/view.ts',
        formats: ['es'],
        fileName: () => (isMain ? 'main.mjs' : 'view.mjs'),
      },
      rolldownOptions: {
        external: isMain ? [/^node:/] : [],
      },
    },
  };
});
