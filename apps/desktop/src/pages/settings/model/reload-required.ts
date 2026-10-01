import { computed } from 'vue';
import type { ContributionsRef } from '@/shared/api/engine/contributions.ts';
import { staleAnswerElements } from '@/shared/lib/answer-element.ts';

/**
 * Перезагрузка окна нужна в единственном случае (R7): элемент ввода
 * доверенного расширения уже определён в окне, а расширение обновлено до
 * версии с другими файлами. `customElements.define` повторить нельзя, поэтому
 * определённый элемент остаётся прежним до перезагрузки.
 */
export const useReloadRequired = (contributions: ContributionsRef) =>
  computed(
    () => staleAnswerElements(contributions.value.exerciseTypes).length > 0,
  );
