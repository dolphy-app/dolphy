import {
  isTypingChord,
  KeybindingSyntaxError,
  parseChord,
} from './keystroke.ts';
import type { SyntaxReason } from './keystroke.ts';
import type { Platform } from './platform.ts';
import { parseWhen, whenOverlaps, WhenSyntaxError } from './when.ts';
import type { WhenExpr } from './when.ts';
import type { WhenReason } from './when.ts';

export const KEY_MAX_LENGTH = 64;

/** Условие «фокус в поле ввода»: привязка с набором, который с ним пересекается, срабатывала бы при наборе. */
const WHILE_TYPING: WhenExpr = { type: 'key', key: 'inputFocus' };

export type BindingProblem =
  | {
      readonly field: 'key';
      readonly reason: 'syntax';
      readonly detail: SyntaxReason | 'too-long-text';
    }
  | {
      readonly field: 'when';
      readonly reason: 'syntax';
      readonly detail: WhenReason;
      readonly position: number;
    }
  | {
      readonly field: 'when';
      readonly reason: 'typing';
      readonly detail: 'typing';
    };

const TYPING: BindingProblem = {
  field: 'when',
  reason: 'typing',
  detail: 'typing',
};

/**
 * Проверка привязки: клавиши (на каждой из `platforms`: `Mod` раскрывается по
 * платформе, и запись вроде `Mod+Ctrl+K` верна не везде), условие и правило
 * «сочетание без Ctrl и Meta, которое печатает или правит текст, должно быть
 * неактивно, пока фокус в поле ввода». `null` — привязка верна.
 */
export const validateBinding = (
  binding: { readonly key: string; readonly when: string | null },
  platforms: readonly Platform[],
): BindingProblem | null => {
  if (binding.key.length > KEY_MAX_LENGTH) {
    return { field: 'key', reason: 'syntax', detail: 'too-long-text' };
  }
  let typing = false;
  for (const platform of platforms) {
    try {
      typing ||= isTypingChord(parseChord(binding.key, platform));
    } catch (error) {
      if (error instanceof KeybindingSyntaxError) {
        return { field: 'key', reason: 'syntax', detail: error.reason };
      }
      throw error;
    }
  }
  if (binding.when === null || binding.when.trim() === '') {
    return typing ? TYPING : null;
  }
  try {
    const when = parseWhen(binding.when);
    return typing && whenOverlaps(when, WHILE_TYPING) ? TYPING : null;
  } catch (error) {
    if (error instanceof WhenSyntaxError) {
      return {
        field: 'when',
        reason: 'syntax',
        detail: error.reason,
        position: error.position,
      };
    }
    throw error;
  }
};
