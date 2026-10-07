import { vi } from 'vitest';
import { MOUNTABLE } from '@dolphy-app/extension-api';
import type {
  MountContext,
  Mountable,
  Unmount,
} from '@dolphy-app/extension-api';

export type AnyContext = MountContext<unknown, unknown, unknown>;

/**
 * `Mountable`, написанный на DOM вручную: записывает вызовы и ctx. Без
 * `mount` рисует props текстом и возвращает очистку `cleanup`.
 */
export const fakeMountable = (
  mount?: (el: HTMLElement, ctx: AnyContext) => Unmount | Promise<Unmount>,
) => {
  const cleanup = vi.fn();
  const calls: { el: HTMLElement; ctx: AnyContext }[] = [];
  const mountable: Mountable<unknown, unknown, unknown> = {
    [MOUNTABLE]: true,
    mount: (el, ctx) => {
      calls.push({ el, ctx });
      if (mount !== undefined) return mount(el, ctx);
      el.textContent = JSON.stringify(ctx.props);
      return cleanup;
    },
  };
  return { mountable, cleanup, calls };
};
