/**
 * Флаг сборки: `SPIRULA_SMOKE_BUILD=1` при `vite build` (`vite.config.ts`, `define`).
 * В обычной сборке — `false`, код смоука вырезается как недостижимый.
 */
declare const __SPIRULA_SMOKE_BUILD__: boolean;
