import { reactive } from 'vue';
import type { LearningEngine } from '@dolphy-app/engine-contract';

/** Пауза перед записью после серии нажатий клавиш. */
const COMMIT_DELAY_MS = 300;

export interface MaterialLayoutState {
  /** Выбранная ширина панели теории, px; `null` — умолчание. */
  width: number | null;
  collapsed: boolean;
}

export interface MaterialLayout {
  readonly state: MaterialLayoutState;
  /** Читает сохранённое один раз; выбор, сделанный раньше ответа движка, не затирается. */
  hydrate(): Promise<void>;
  /** Живая ширина при перетаскивании: ничего не пишет. */
  preview(width: number): void;
  /** Записывает текущую ширину (отпускание кнопки мыши). */
  commit(): Promise<void>;
  /** Записывает ширину после паузы (серия нажатий клавиш). */
  commitSoon(): void;
  /** Ширина по умолчанию. */
  reset(): Promise<void>;
  setCollapsed(collapsed: boolean): Promise<void>;
}

export const createMaterialLayout = (
  engine: LearningEngine,
): MaterialLayout => {
  const state = reactive<MaterialLayoutState>({
    width: null,
    collapsed: false,
  });
  const hydration: { promise: Promise<void> | null; touched: boolean } = {
    promise: null,
    touched: false,
  };
  const timer: { id: ReturnType<typeof setTimeout> | null } = { id: null };

  // отказ записи не откатывает экран: настройка применится до перезапуска
  const save = async (
    patch: Parameters<LearningEngine['settings']['setUi']>[0],
  ) => {
    try {
      await engine.settings.setUi(patch);
    } catch (error) {
      console.error({ error }, 'material panel layout was not saved');
    }
  };

  const hydrate = () => {
    hydration.promise ??= engine.settings.getUi().then(
      (ui) => {
        if (hydration.touched) return;
        state.width = ui.materialWidth ?? null;
        state.collapsed = ui.materialCollapsed === true;
      },
      (error) => {
        console.error({ error }, 'material panel layout was not loaded');
      },
    );
    return hydration.promise;
  };

  const commit = async () => {
    if (timer.id !== null) clearTimeout(timer.id);
    timer.id = null;
    await save({ materialWidth: state.width });
  };

  return {
    state,
    hydrate,
    preview: (width) => {
      hydration.touched = true;
      state.width = width;
    },
    commit,
    commitSoon: () => {
      if (timer.id !== null) clearTimeout(timer.id);
      timer.id = setTimeout(() => void commit(), COMMIT_DELAY_MS);
    },
    reset: async () => {
      hydration.touched = true;
      state.width = null;
      await commit();
    },
    setCollapsed: async (collapsed) => {
      hydration.touched = true;
      state.collapsed = collapsed;
      await save({ materialCollapsed: collapsed });
    },
  };
};
