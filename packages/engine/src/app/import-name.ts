/**
 * Имя каталога импортированного курса: `<id расширения>-<имя файла без
 * расширения, латиницей через дефис>` (R6). Повторный импорт файла с тем же
 * именем тем же расширением даёт то же имя и заменяет прежний каталог.
 */

/** Кириллица → латиница (упрощённая ГОСТ 7.79 «система Б» без диакритики). */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ґ: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  є: 'ye',
  ж: 'zh',
  з: 'z',
  и: 'i',
  і: 'i',
  ї: 'yi',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Длина части с именем файла; имя каталога целиком — не длиннее 64 + 1 + 60 знаков. */
const MAX_SLUG_LENGTH = 60;

/** Имя файла → слаг `a-z0-9` через дефис; пусто, если латиницы и цифр нет совсем. */
export const importSlug = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  // имена с macOS приходят разложенными (`й` = `и` + знак): сначала собираем, потом транслитерируем
  const latin = [...stem.normalize('NFC').toLowerCase()]
    .map((char) => CYRILLIC[char] ?? char)
    .join('');
  return latin
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
};

/** `<id расширения>-<слаг>`; без слага — `import`. */
export const importDirectoryName = (
  extensionId: string,
  fileName: string,
): string => `${extensionId}-${importSlug(fileName) || 'import'}`;
