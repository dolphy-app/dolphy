import { onMounted, ref, shallowRef } from 'vue';
import type {
  EngineDiagnosticsDto,
  LearningEngine,
  ScorerInfoDto,
} from '@lms/engine-contract';

export interface EngineInfo {
  diagnostics: EngineDiagnosticsDto;
  scorer: ScorerInfoDto;
}

export const loadEngineInfo = async (
  engine: LearningEngine,
): Promise<EngineInfo> => {
  const [diagnostics, scorer] = await Promise.all([
    engine.diagnostics(),
    engine.settings.getScorer(),
  ]);
  return { diagnostics, scorer };
};

export const useEngineInfo = (engine: LearningEngine) => {
  const info = shallowRef<EngineInfo | null>(null);
  const error = ref<string | null>(null);

  const refresh = async () => {
    try {
      info.value = await loadEngineInfo(engine);
      error.value = null;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  };

  onMounted(() => void refresh());
  return { info, error, refresh };
};
