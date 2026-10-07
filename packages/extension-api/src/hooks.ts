/**
 * Hooks of the learning cycle: handlers an extension registers with
 * `server.before(name, handler)` to take part in an operation before the
 * engine performs it. The closed set below is the whole vocabulary; the host
 * and the test server validate requests and responses with the schemas of
 * `hook-schemas.ts`.
 */

import type { z } from 'zod';
import type { EXTENSION_HOOKS } from './hook-schemas.ts';

/** Limits on hooks; the host and the engine check the same numbers. */
export const EXTENSION_HOOK_LIMITS = Object.freeze({
  /** Budget of one handler call, ms. */
  timeoutMs: 30_000,
  /** Hooks registered by one extension. */
  hooks: 8,
  /** Exercises in a `practice.batch` response. */
  maxExercises: 500,
});

/** Hooks an extension can register with `server.before`. */
export const EXTENSION_HOOK_NAMES = [
  'session.start',
  'practice.batch',
] as const;
export type ExtensionHookName = (typeof EXTENSION_HOOK_NAMES)[number];

export type HookRequest<N extends ExtensionHookName> = z.input<
  (typeof EXTENSION_HOOKS)[N]['request']
>;

export type HookResponse<N extends ExtensionHookName> = z.output<
  (typeof EXTENSION_HOOKS)[N]['response']
>;

/** What a handler of `server.before(name, …)` may return. */
export type HookHandler<N extends ExtensionHookName> = (
  request: HookRequest<N>,
) => HookResponse<N> | Promise<HookResponse<N>>;
