import type { QueryCache } from '@pinia/colada';
import type {
  LearningEngine,
  PreviewRepositoryRequest,
  RepositoryPreviewDto,
} from '@dolphy-app/engine-contract';

/** Сколько предпросмотр считается свежим: «Назад» и повторное открытие диалога не качают репозиторий заново. */
export const PREVIEW_STALE_MS = 60_000;

/** Общий префикс ключей предпросмотров: по нему кэш сбрасывается целиком. */
const PREVIEW_KEY = ['repository', 'preview'] as const;

const previewQuery = (
  engine: LearningEngine,
  request: PreviewRepositoryRequest,
) => ({
  key: [...PREVIEW_KEY, request.url, request.ref ?? null],
  query: () => engine.repositories.preview(request),
  staleTime: PREVIEW_STALE_MS,
});

/**
 * Предпросмотр репозитория через кэш: свежая запись возвращается без вызова
 * движка (ни загрузки, ни `repository-progress`), устаревшая и запись с
 * ошибкой загружаются заново. Ошибка движка (в том числе отмена) бросается как
 * есть и в кэше не остаётся: следующий вызов идёт в движок.
 */
export const loadRepositoryPreview = async (
  queryCache: QueryCache,
  engine: LearningEngine,
  request: PreviewRepositoryRequest,
): Promise<RepositoryPreviewDto> => {
  const entry = queryCache.ensure(previewQuery(engine, request));
  const state = await queryCache.refresh(entry);
  if (state.status === 'error') throw state.error;
  return state.data as RepositoryPreviewDto;
};

/** Помечает все предпросмотры устаревшими, не перезагружая их. */
export const invalidateRepositoryPreviews = (queryCache: QueryCache) =>
  queryCache.invalidateQueries({ key: [...PREVIEW_KEY] }, false);

/**
 * Любая перезагрузка библиотеки меняет `installed` и `inLibrary` в
 * предпросмотрах: кэш сбрасывается. Слушатель не вызывает команды движка
 * синхронно (API §7); возвращает функцию отписки.
 */
export const bindRepositoryPreviews = (
  engine: LearningEngine,
  queryCache: QueryCache,
): (() => void) =>
  engine.subscribe((event) => {
    if (event.type === 'library-reloaded') {
      void invalidateRepositoryPreviews(queryCache);
    }
  });
