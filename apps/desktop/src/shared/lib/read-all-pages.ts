import type { Page, PageRequest } from '@spirula/engine-contract';

/** Максимальная страница списка (API §10); курсов и узлов прогресса по курсам заведомо меньше. */
const PAGE_LIMIT = 500;

/** Собирает все страницы постраничного чтения движка. */
export const readAllPages = async <T>(
  read: (req: PageRequest) => Promise<Page<T>>,
): Promise<T[]> => {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await read(
      cursor === undefined
        ? { limit: PAGE_LIMIT }
        : { limit: PAGE_LIMIT, cursor },
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return items;
};
