import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_ID_PATTERN } from '@dolphy-app/extension-api';
import {
  ASSET_MIME,
  assetExtensionOf,
  assetSizeLimit,
  type AssetExtension,
} from '@dolphy-app/extension-catalog';
import type { MainLogger } from '../logger.ts';
import frameRuntime from './frame-runtime.js?raw';
import type { Shell } from './types.ts';

export const EXTENSION_SCHEME = 'dolphy-ext';

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.js', '.mjs']);

export interface ExtensionAssetsDeps {
  app: { whenReady(): Promise<unknown> };
  protocol: {
    registerSchemesAsPrivileged(
      schemes: {
        scheme: string;
        privileges: {
          standard: boolean;
          secure: boolean;
          supportFetchAPI: boolean;
          corsEnabled: boolean;
        };
      }[],
    ): void;
    handle(
      scheme: string,
      handler: (request: { url: string }) => Promise<Response> | Response,
    ): void;
  };
  net: { fetch(url: string): Promise<Response> };
  /** Корни расширений в порядке приоритета: режим разработчика, пользовательский, из поставки. */
  roots: readonly string[];
  /** Файловая система; ошибки (нет файла, нет доступа) протокол превращает в 404. */
  fs: {
    realpath(file: string): Promise<string>;
    stat(file: string): Promise<{ isFile(): boolean; size: number }>;
  };
  logger: MainLogger;
}

const notFound = () => new Response(null, { status: 404 });

/** Служебный префикс: пути под ним отдаёт только сам протокол, не каталог расширения. */
export const RESERVED_PREFIX = '__dolphy';

/**
 * CSP страницы рамки расширения `id`: без сети, форм и `<base>`; скрипты,
 * стили, изображения и шрифты — только с `dolphy-ext://<id>` этого же
 * расширения (плюс `data:`/`blob:` и встроенные стили). Источник-хост на
 * непрозрачном origin работает: чужое расширение блокируется до запроса к
 * протоколу (эксперимент в Electron, `specs/extension-assets/SPEC.md`).
 */
export const frameCsp = (id: string): string => {
  const own = `${EXTENSION_SCHEME}://${id}`;
  return [
    "default-src 'none'",
    `script-src ${own}`,
    `style-src ${own} 'unsafe-inline'`,
    `img-src ${own} data: blob:`,
    `font-src ${own} data:`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
};

/** SVG отдаётся как документ без скриптов, сети и ресурсов: только как картинка. */
export const SVG_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const frameHtml = (id: string) =>
  `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${id}</title>
<style>
html { background: transparent; }
body {
  display: flow-root;
  margin: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface, 0, 0, 0));
  font: 16px/1.5 Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
</style>
<script type="module" src="${EXTENSION_SCHEME}://${id}/${RESERVED_PREFIX}/frame.js"></script>
</head>
<body></body>
</html>
`;

// сам рантайм — функция; вызов с настоящим `window` и динамическим import()
const FRAME_SCRIPT = `${frameRuntime}\ndolphyFrameRuntime(window, (url) => import(url));\n`;

type Route =
  | { kind: 'file'; file: string; asset: AssetExtension | null }
  | { kind: 'rejected'; status: number }
  | { kind: 'frame-page'; id: string }
  | { kind: 'frame-script' };

const rejected = (status: number): Route => ({ kind: 'rejected', status });

const isDotted = (relative: string) =>
  relative.split(/[\\/]/).some((segment) => segment.startsWith('.'));

/**
 * Протокол `dolphy-ext://<id>/<путь>`: отдаёт renderer'у из каталога
 * расширения только скрипты (`.js`/`.mjs`) и ресурсы (`css`, `svg`, `png`,
 * `webp`, `jpg`, `jpeg`, `woff2`; расширение — строчными буквами). Остальное
 * (`extension.json`, README, `.json`, `.md`, пути с точки), выход за каталог
 * и символические ссылки наружу — 404; ресурсу не разрешена ни одна ссылка
 * внутри каталога, размер ресурса ограничен потолком его типа, потому что
 * расширения режима разработчика и скопированные вручную каталог не
 * проверял. Путь `__dolphy/frame.html` и `__dolphy/frame.js` — страница и
 * рантайм изолированной рамки: генерируются протоколом и не читаются из
 * каталога расширения.
 */
export const createExtensionAssetsShell = ({
  app,
  protocol,
  net,
  roots,
  fs,
  logger,
}: ExtensionAssetsDeps): Shell => {
  const resolveFile = async (
    id: string,
    relative: string,
  ): Promise<Route | null> => {
    const asset = assetExtensionOf(relative);
    if (asset === null && !SCRIPT_EXTENSIONS.has(path.extname(relative))) {
      return null;
    }
    if (isDotted(relative)) return null;
    for (const root of roots) {
      const dir = path.resolve(root, id);
      const file = path.resolve(dir, relative);
      if (!file.startsWith(dir + path.sep)) continue;
      const [first] = file.slice(dir.length + 1).split(path.sep);
      if (first === RESERVED_PREFIX) return null;
      let realDir: string;
      let real: string;
      let size: number;
      try {
        realDir = await fs.realpath(dir);
        real = await fs.realpath(file);
        const info = await fs.stat(real);
        if (!info.isFile()) continue;
        size = info.size;
      } catch {
        continue;
      }
      // ссылка из каталога расширения наружу (корень расширения может быть ссылкой — это выбор разработчика)
      if (!real.startsWith(realDir + path.sep)) {
        logger.warn({ file, real }, 'extension asset points outside');
        return rejected(404);
      }
      if (asset !== null) {
        // ресурс — только обычный файл: ни ссылки на него, ни ссылки в его пути
        if (real !== path.join(realDir, path.relative(dir, file))) {
          logger.warn({ file, real }, 'extension asset is a symbolic link');
          return rejected(404);
        }
        if (size > assetSizeLimit(asset)) {
          logger.warn({ file, size }, 'extension asset is too large');
          return rejected(413);
        }
      }
      return { kind: 'file', file: real, asset };
    }
    return null;
  };

  const resolve = async (url: URL): Promise<Route | null> => {
    const id = decodeURIComponent(url.hostname);
    if (!EXTENSION_ID_PATTERN.test(id)) return null;
    const relative = decodeURIComponent(url.pathname.slice(1));
    if (relative === `${RESERVED_PREFIX}/frame.html`) {
      return { kind: 'frame-page', id };
    }
    if (relative === `${RESERVED_PREFIX}/frame.js`) {
      return { kind: 'frame-script' };
    }
    return resolveFile(id, relative);
  };

  const serveFile = async (file: string, asset: AssetExtension | null) => {
    try {
      const upstream = await net.fetch(pathToFileURL(file).href);
      return new Response(upstream.body, {
        status: upstream.status,
        // renderer грузится с file:// (origin null), рамка — с непрозрачным origin:
        // модуль и шрифт идут в режиме CORS
        headers: {
          'Content-Type': asset === null ? 'text/javascript' : ASSET_MIME[asset],
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          // после перезагрузки в режиме разработчика окно обязано увидеть свежий код
          'Cache-Control': 'no-cache',
          ...(asset === 'svg' ? { 'Content-Security-Policy': SVG_CSP } : {}),
        },
      });
    } catch (error) {
      logger.warn({ error, file }, 'extension asset was not read');
      return notFound();
    }
  };

  const handler = async (request: { url: string }) => {
    let route: Route | null;
    try {
      route = await resolve(new URL(request.url));
    } catch {
      return notFound();
    }
    if (route === null) return notFound();
    if (route.kind === 'rejected') {
      return new Response(null, { status: route.status });
    }
    if (route.kind === 'file') return serveFile(route.file, route.asset);
    if (route.kind === 'frame-page') {
      return new Response(frameHtml(route.id), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': frameCsp(route.id),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
        },
      });
    }
    // рамка с непрозрачным origin грузит модуль в режиме CORS
    return new Response(FRAME_SCRIPT, {
      headers: {
        'Content-Type': 'text/javascript',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  };

  return {
    register: () => {
      protocol.registerSchemesAsPrivileged([
        {
          scheme: EXTENSION_SCHEME,
          privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
          },
        },
      ]);
      void app
        .whenReady()
        .then(() => protocol.handle(EXTENSION_SCHEME, handler));
    },
  };
};
