import { useI18n } from 'vue-i18n';
import type {
  ContributionsDto,
  ExtensionMessagesDto,
} from '@dolphy-app/engine-contract';
import { resolveText } from '@dolphy-app/extension-api';
import { useContributions } from '@/shared/api/engine/contributions.ts';

/** Подпись вклада расширения `extensionId` по таблицам вкладов; для кода вне компонентов. */
export const textOfExtension = (
  value: string,
  extensionId: string,
  contributions: Pick<ContributionsDto, 'messages'>,
  locale: string,
): string => resolveText(value, contributions.messages[extensionId], locale);

/** Подписи расширения из манифеста (`%ключ%`) на текущем языке окна. */
export interface ExtensionText {
  /** Подпись по таблицам самого значения (запись списка расширений, `ExtensionInfoDto.messages`). */
  withTables(value: string, tables: ExtensionMessagesDto | undefined): string;
  /** Подпись вклада расширения `extensionId` по таблицам живых вкладов. */
  of(value: string, extensionId: string): string;
  /** Название расширения: `name` манифеста или id. */
  nameOf(info: {
    id: string;
    name: string | null;
    messages: ExtensionMessagesDto;
  }): string;
}

/**
 * Подстановка `%ключ%`: цепочка «язык окна → `en` → `%ключ%`». Читает язык
 * и таблицы реактивно, поэтому вычисляемые значения пересчитываются при смене
 * языка и обновлении вкладов без запросов к движку.
 */
export const useExtensionText = (): ExtensionText => {
  const { locale } = useI18n();
  const contributions = useContributions();
  const withTables = (
    value: string,
    tables: ExtensionMessagesDto | undefined,
  ): string => resolveText(value, tables, locale.value);
  return {
    withTables,
    of: (value, extensionId) =>
      textOfExtension(value, extensionId, contributions.value, locale.value),
    nameOf: (info) => withTables(info.name ?? info.id, info.messages),
  };
};
