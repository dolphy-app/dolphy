import type { FrameworkPreset } from './index.ts';

/**
 * React: `.tsx` and `.jsx` with the automatic JSX runtime, compiled by the
 * bundler itself (no `@vitejs/plugin-react`: a bundle needs no Fast Refresh).
 * `react` and `react-dom` are the author's dependencies and go into the bundle:
 * every extension carries its own copy.
 */
export const reactPreset: FrameworkPreset = {
  name: 'react',
  extensions: ['.tsx', '.jsx'],
  packages: ['react', 'react-dom', 'scheduler'],
  plugins: () => [],
  // `development: false`: Vite turns the development JSX on (`jsxDEV` of
  // `react/jsx-dev-runtime`, empty in the production React) when `NODE_ENV` is not "production"
  options: { oxc: { jsx: { runtime: 'automatic', development: false } } },
};
