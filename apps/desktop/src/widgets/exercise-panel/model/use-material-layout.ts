import type { LearningEngine } from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { createMaterialLayout } from './material-layout.ts';
import type { MaterialLayout } from './material-layout.ts';

const layouts = new WeakMap<LearningEngine, MaterialLayout>();

/** Одно состояние на окно: сессия и вход-тест показывают панель одинаково. */
export const useMaterialLayout = (): MaterialLayout => {
  const engine = useEngine();
  let layout = layouts.get(engine);
  if (layout === undefined) {
    layout = createMaterialLayout(engine);
    layouts.set(engine, layout);
  }
  void layout.hydrate();
  return layout;
};
