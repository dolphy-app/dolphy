import type { ClientAnswerView } from '@/shared/lib/extension-clients.ts';

/**
 * Компонент ввода ответа для вида задания `type`: вид самого расширения —
 * владельца вида, иначе первый по id расширения (реестр отдаёт их в этом
 * порядке); `null` — вида нет (расширение отключено, удалено, ещё грузится или
 * не загрузилось).
 */
export const answerViewOf = (
  views: readonly ClientAnswerView[],
  type: string,
  ownerId: string,
): ClientAnswerView | null => {
  const matching = views.filter((view) => view.type === type);
  return (
    matching.find((view) => view.extensionId === ownerId) ?? matching[0] ?? null
  );
};
