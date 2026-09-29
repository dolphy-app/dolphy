/**
 * Флаг сборки: `LMS_SMOKE_BUILD=1` при `vite build` (`vite.config.ts`, `define`).
 * В обычной сборке — `false`, код смоука вырезается как недостижимый.
 */
declare const __LMS_SMOKE_BUILD__: boolean;
