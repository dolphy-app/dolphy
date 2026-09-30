import type {
  AssetRef,
  ExerciseContentDto,
  LearningEngine,
} from '@spirula-app/engine-contract';

export interface ExerciseText {
  /** Markdown условия. */
  prompt: string;
  /** Markdown ответа; `null` — у упражнения нет эталонного ответа. */
  answer: string | null;
}

const readText = async (engine: LearningEngine, ref: AssetRef) =>
  (await engine.library.readAsset(ref)).text;

export const readExerciseContent = async (
  engine: LearningEngine,
  content: ExerciseContentDto,
): Promise<ExerciseText> => {
  switch (content.type) {
    case 'inlineMarkdown':
      return { prompt: content.text, answer: null };
    case 'inlineFlashcard':
      return { prompt: content.front, answer: content.back ?? null };
    case 'markdown':
      return { prompt: await readText(engine, content.ref), answer: null };
    default: {
      const prompt = await readText(engine, content.front);
      const answer = content.back ? await readText(engine, content.back) : null;
      return { prompt, answer };
    }
  }
};

export const readOptionalText = (
  engine: LearningEngine,
  ref: AssetRef | undefined,
) => (ref ? readText(engine, ref) : Promise.resolve(null));
