import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_ID_PATTERN } from '@spirula/extension-api';
import type { MainLogger } from '../logger.ts';
import frameRuntime from './frame-runtime.js?raw';
import type { Shell } from './types.ts';

export const EXTENSION_SCHEME = 'spirula-ext';

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
  /** Корни расширений в порядке приоритета: пользовательский, затем из поставки. */
  roots: readonly string[];
  exists(file: string): boolean;
  logger: MainLogger;
}

const notFound = () => new Response(null, { status: 404 });

/** Служебный префикс: пути под ним отдаёт только сам протокол, не каталог расширения. */
export const RESERVED_PREFIX = '__spirula';

/**
 * Страница рамки: только загрузчик, никакого встроенного кода. Без сети,
 * форм и `<base>`; скрипты — только по схеме `spirula-ext:`.
 */
export const FRAME_CSP =
  "default-src 'none'; script-src spirula-ext:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

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
const FRAME_SCRIPT = `${frameRuntime}\nspirulaFrameRuntime(window, (url) => import(url));\n`;

type Route =
  | { kind: 'file'; file: string }
  | { kind: 'frame-page'; id: string }
  | { kind: 'frame-script' };

/**
 * Протокол `spirula-ext://<id>/<путь>`: отдаёт renderer'у только скрипты
 * (`.js`/`.mjs`) из каталога расширения; выход за каталог — 404. Путь
 * `__spirula/frame.html` и `__spirula/frame.js` — страница и рантайм изолированной
 * рамки: генерируются протоколом и не читаются из каталога расширения.
 */
export const createExtensionAssetsShell = ({
  app,
  protocol,
  net,
  roots,
  exists,
  logger,
}: ExtensionAssetsDeps): Shell => {
  const resolveFile = (id: string, relative: string): string | null => {
    if (!SCRIPT_EXTENSIONS.has(path.extname(relative))) return null;
    for (const root of roots) {
      const dir = path.resolve(root, id);
      const file = path.resolve(dir, relative);
      if (!file.startsWith(dir + path.sep)) continue;
      const [first] = file.slice(dir.length + 1).split(path.sep);
      if (first === RESERVED_PREFIX) return null;
      if (exists(file)) return file;
    }
    return null;
  };

  const resolve = (url: URL): Route | null => {
    const id = decodeURIComponent(url.hostname);
    if (!EXTENSION_ID_PATTERN.test(id)) return null;
    const relative = decodeURIComponent(url.pathname.slice(1));
    if (relative === `${RESERVED_PREFIX}/frame.html`) {
      return { kind: 'frame-page', id };
    }
    if (relative === `${RESERVED_PREFIX}/frame.js`) {
      return { kind: 'frame-script' };
    }
    const file = resolveFile(id, relative);
    return file === null ? null : { kind: 'file', file };
  };

  const serveFile = async (file: string) => {
    try {
      const upstream = await net.fetch(pathToFileURL(file).href);
      return new Response(upstream.body, {
        status: upstream.status,
        // renderer грузится с file:// (origin null): модульный import() идёт в режиме CORS
        headers: {
          'Content-Type': 'text/javascript',
          'Access-Control-Allow-Origin': '*',
          // после перезагрузки в режиме разработчика окно обязано увидеть свежий код
          'Cache-Control': 'no-cache',
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
      route = resolve(new URL(request.url));
    } catch {
      return notFound();
    }
    if (route === null) return notFound();
    if (route.kind === 'file') return serveFile(route.file);
    if (route.kind === 'frame-page') {
      return new Response(frameHtml(route.id), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': FRAME_CSP,
          'Cache-Control': 'no-cache',
        },
      });
    }
    // рамка с непрозрачным origin грузит модуль в режиме CORS
    return new Response(FRAME_SCRIPT, {
      headers: {
        'Content-Type': 'text/javascript',
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
