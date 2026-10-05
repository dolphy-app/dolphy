import MarkdownIt from 'markdown-it';

/** Сколько картинок README окно запрашивает (остальные заменяются `alt`). */
export const MAX_README_IMAGES = 8;

/** Расширения картинок, которые окно запрашивает у движка (`extensions.docImage`). */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'webp',
  'jpg',
  'jpeg',
]);

export interface ReadmeRenderOptions {
  /**
   * На сколько уровней сдвинуты заголовки (`#` → `h<1 + offset>`, не глубже `h6`):
   * README лежит под заголовками страницы или диалога.
   */
  headingOffset?: number;
  /** `false` — картинки заменяются `alt` (журнал изменений: картинки только у README). По умолчанию `true`. */
  images?: boolean;
}

/**
 * Путь файла версии, на который указывает картинка README: относительный, без
 * схемы, `..`, обратных косых, запроса и фрагмента, с расширением `png`, `webp`,
 * `jpg` или `jpeg`. `null` — картинка не из файлов версии.
 */
export const readmeImagePath = (src: string): string | null => {
  if (src === '' || /[?#\\]/.test(src) || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.startsWith('/')) return null;
  const segments = decoded.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0 || segments.includes('..')) return null;
  const file = segments[segments.length - 1] ?? '';
  const extension = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (!file.includes('.') || !IMAGE_EXTENSIONS.has(extension)) return null;
  return segments.join('/');
};

/** Ссылка, которую можно открыть во внешнем браузере: только `https:`. */
const isOpenableLink = (href: string): boolean => {
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Рендерер README и журнала изменений. Markdown без сырого HTML (`html: false`);
 * ссылки — только `https:` (`target="_blank"`, `rel="noopener noreferrer"`),
 * остальные выводятся обычным текстом; картинка — заглушка `<img data-src>` без
 * `src` (до `MAX_README_IMAGES` штук и только файлы версии нужных типов),
 * остальные заменяются своим `alt`. Окно само подставляет `src` через `docImage`.
 */
export const createReadmeRenderer = () => {
  const markdown = new MarkdownIt({ html: false, linkify: false });
  const { escapeHtml } = markdown.utils;

  // ссылка не `https:` не должна ни вести, ни выглядеть ссылкой: остаётся её текст
  markdown.core.ruler.push('readme_links', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || block.children === null) continue;
      const open: Array<{
        token: (typeof block.children)[number];
        ok: boolean;
      }> = [];
      for (const token of block.children) {
        if (token.type === 'link_open') {
          const ok = isOpenableLink(String(token.attrGet('href') ?? ''));
          if (ok) {
            token.attrSet('target', '_blank');
            token.attrSet('rel', 'noopener noreferrer');
          } else {
            token.hidden = true;
          }
          open.push({ token, ok });
        } else if (token.type === 'link_close') {
          if (open.pop()?.ok === false) token.hidden = true;
        }
      }
    }
  });

  markdown.renderer.rules['image'] = (tokens, index, options, env) => {
    const token = tokens[index];
    if (token === undefined) return '';
    const state = env as { images: number; allowImages: boolean };
    const alt = markdown.renderer.renderInlineAsText(
      token.children ?? [],
      options,
      env,
    );
    const path = readmeImagePath(String(token.attrGet('src') ?? ''));
    if (
      path === null ||
      !state.allowImages ||
      state.images >= MAX_README_IMAGES
    ) {
      return escapeHtml(alt);
    }
    state.images += 1;
    return `<img data-src="${escapeHtml(path)}" alt="${escapeHtml(alt)}" class="readme-image">`;
  };

  // прокручиваемые блоки должны получать фокус, иначе с клавиатуры их не прокрутить (axe)
  for (const rule of ['fence', 'code_block'] as const) {
    const render = markdown.renderer.rules[rule];
    if (!render) throw new Error(`markdown-it has no "${rule}" rule`);
    markdown.renderer.rules[rule] = (...args) =>
      render(...args).replace('<pre', '<pre tabindex="0"');
  }
  markdown.renderer.rules['table_open'] = () =>
    '<div class="readme-table" tabindex="0"><table>\n';
  markdown.renderer.rules['table_close'] = () => '</table></div>\n';

  return (source: string, options: ReadmeRenderOptions = {}): string => {
    const offset = options.headingOffset ?? 0;
    const env = { images: 0, allowImages: options.images !== false };
    const tokens = markdown.parse(source, env);
    if (offset > 0) {
      for (const token of tokens) {
        if (token.type !== 'heading_open' && token.type !== 'heading_close') {
          continue;
        }
        const level = Number(token.tag.slice(1));
        token.tag = `h${Math.min(6, level + offset)}`;
      }
    }
    return markdown.renderer.render(tokens, markdown.options, env);
  };
};
