import { shallowRef } from 'vue';

/**
 * Отмена и возврат ответов текущей сессии обучения. Страница сессии
 * выставляет значение, пока смонтирована, команды приложения (`Ctrl+Z`,
 * палитра) читают его: команды живут всегда, чтобы сочетания переназначались
 * в настройках и вне сессии.
 */
export interface SessionHistory {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export const activeSessionHistory = shallowRef<SessionHistory | null>(null);
